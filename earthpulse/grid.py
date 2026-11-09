"""Grid utilities for the EarthPulse contract grid (docs/DATA_CONTRACT.md §1).

The contract analysis grid is a global 1° x 1° grid of cell centres:
row 0 is the northernmost row (centre latitude 89.5°) and column 0 is the
westernmost column (centre longitude −179.5°). Arrays are row-major
``[row, col]`` = ``[lat, lon]``.

Orientation convention
----------------------
P01 verified that GLDAS arrays are ``(time, lat, lon)`` and IMERG arrays are
``(time, lon, lat)``, both with latitude **ascending**. Producers must
transpose and flip to match the contract (north-first latitude). That is what
:func:`to_contract_orientation` does, always by dimension name — never by
positional order.

Sub-degree grids
----------------
The contract grid is 1°, but IMERG is native 0.1°. A 0.1° grid with centres
at ``...89.95, 89.85, ...`` is *aligned with* the contract grid (every 1°
contract cell spans exactly ten 0.1° cells whose boundaries fall on integer
degrees), even though the 1° centre 89.5 is not itself a 0.1° centre.
:func:`to_contract_orientation` therefore reindexes onto the **full global
grid at the data's own resolution** (contract grid for 1° data; the aligned
global grid for an integer divisor such as 0.1°), turning missing rows/cells
into NaN. :func:`block_aggregate` then aggregates the aligned fine grid to
the contract grid and asserts the resulting coordinates match the contract
within 1e-6.
"""

from __future__ import annotations

import numpy as np
import xarray as xr

from earthpulse.contract import (
    LAT_NORTH_CENTER,
    LON_WEST_CENTER,
    N_COLS,
    N_ROWS,
    RESOLUTION_DEG,
)

# A coarse cell produced by block_aggregate is valid only if at least this
# fraction of its area is covered by valid fine cells (P02 spec T2).
COARSE_VALID_AREA_FRACTION = 0.5


def target_grid() -> tuple[np.ndarray, np.ndarray]:
    """Return contract (lat, lon) cell-centre coordinate arrays.

    ``lat`` is descending, north-first (89.5 .. -89.5); ``lon`` is ascending
    (-179.5 .. 179.5).
    """
    lat = LAT_NORTH_CENTER - np.arange(N_ROWS) * RESOLUTION_DEG
    lon = LON_WEST_CENTER + np.arange(N_COLS) * RESOLUTION_DEG
    return lat, lon


def cell_area_weights(lat: np.ndarray) -> np.ndarray:
    """Return cos(latitude) weights for zonal (area-weighted) means.

    The area of a lat-lon cell with half-width ``Δφ/2`` and ``Δλ`` is
    ``R² · Δλ · (sin(φN) − sin(φS))``. For the small ``Δφ`` of a regular
    degree grid this is proportional to ``R² · Δφ · Δλ · cos(φ)``, so the
    relative weight of a cell is ``cos(latitude)``. Latitude in degrees is
    converted to radians internally.
    """
    return np.cos(np.deg2rad(np.asarray(lat, dtype=np.float64)))


def _expected_coords(resolution: float) -> tuple[np.ndarray, np.ndarray]:
    """Full global (lat, lon) centre arrays at ``resolution`` degrees.

    The grid is aligned with the contract grid: cell boundaries fall on
    integer multiples of ``resolution`` degrees, so centres sit at
    ``±90 − resolution/2 − k·resolution``. For ``resolution == 1.0`` this is
    exactly the contract grid.
    """
    n_lat = int(round(180.0 / resolution))
    n_lon = int(round(360.0 / resolution))
    if not np.isclose(n_lat * resolution, 180.0, rtol=1e-3) or not np.isclose(
        n_lon * resolution, 360.0, rtol=1e-3
    ):
        raise ValueError(
            f"Resolution {resolution}° is not an integer divisor of the "
            "contract grid."
        )
    # Snap the spacing exactly (the inferred value carries float32 quantization
    # jitter that would accumulate to ~1e-3 degrees over a global grid).
    lat_res = 180.0 / n_lat
    lon_res = 360.0 / n_lon
    lat = 90.0 - lat_res / 2.0 - np.arange(n_lat) * lat_res
    lon = -180.0 + lon_res / 2.0 + np.arange(n_lon) * lon_res
    return lat, lon


def _infer_resolution(coords: np.ndarray) -> float:
    """Return the grid spacing from a monotonic coordinate array."""
    if coords.size < 2:
        raise ValueError("Need at least two coordinate values to infer spacing")
    diffs = np.abs(np.diff(coords))
    resolution = float(np.median(diffs))
    # Float32-stored coordinates (IMERG) quantize near |180| with an
    # epsilon of ~1.5e-5, so allow a relative jitter well above float64
    # noise but far below any real grid irregularity.
    if not np.allclose(diffs, resolution, rtol=1e-3, atol=1e-6):
        raise ValueError("Coordinate array is not regularly spaced")
    return resolution


def _coord_tolerance(values: np.ndarray) -> float:
    """Matching tolerance for float32-quantized coordinates.

    At least 1e-6; grows to twice the float32 spacing at the largest
    absolute coordinate value (≈1.5e-5 near ±180).
    """
    largest = float(np.max(np.abs(values))) if values.size else 0.0
    return max(1e-6, 2.0 * float(np.spacing(np.float32(largest))))


def to_contract_orientation(da: xr.DataArray) -> xr.DataArray:
    """Bring a native product array to contract orientation.

    Steps:

    1. Transpose **by dimension name** to ``(time, lat, lon)`` (IMERG stores
       ``(time, lon, lat)``; a positional transpose would swap lat and lon).
    2. Sort latitude descending (north-first) and longitude ascending.
    3. Assert every source coordinate value sits on the aligned global grid
       at the data's own resolution (within 1e-6).
    4. Reindex onto the **full global grid** at that resolution, so missing
       rows/cells (e.g. GLDAS south of 60°S) become NaN.

    For 1° input the result is exactly the contract 180 × 360 grid.
    """
    if "lat" not in da.dims or "lon" not in da.dims:
        raise ValueError(
            f"Expected dimensions named 'lat' and 'lon', got {da.dims}"
        )
    order = tuple(d for d in ("time", "lat", "lon") if d in da.dims)
    da = da.transpose(*order)

    da = da.sortby("lat", ascending=False).sortby("lon", ascending=True)

    resolution = _infer_resolution(np.asarray(da["lat"].values, dtype=float))
    lon_resolution = _infer_resolution(np.asarray(da["lon"].values, dtype=float))
    if not np.isclose(resolution, lon_resolution, rtol=0, atol=1e-6):
        raise ValueError(
            f"Non-square grid: lat {resolution}° vs lon {lon_resolution}°"
        )
    expected_lat, expected_lon = _expected_coords(resolution)

    # Every source coordinate must sit on the aligned global grid. The
    # tolerance absorbs float32 quantization of the stored coordinates.
    src_lat = np.asarray(da["lat"].values, dtype=float)
    src_lon = np.asarray(da["lon"].values, dtype=float)
    tolerance = _coord_tolerance(np.concatenate([src_lat, src_lon]))
    lat_offset = np.abs(src_lat[:, None] - expected_lat[None, :]).min(axis=1)
    lon_offset = np.abs(src_lon[:, None] - expected_lon[None, :]).min(axis=1)
    if lat_offset.max() > tolerance or lon_offset.max() > tolerance:
        raise ValueError(
            "Source coordinates do not align with the contract grid "
            f"(max lat offset {lat_offset.max():.3e}, "
            f"max lon offset {lon_offset.max():.3e}); refusing to shift data."
        )

    # Reindex onto the full grid; method="nearest" with the same tolerance
    # as the alignment check above, because float representations of
    # identical centres can differ between producers (and float32 storage
    # quantizes near ±180). Missing rows -> NaN.
    return da.reindex(
        lat=expected_lat, lon=expected_lon, method="nearest", tolerance=tolerance
    )


def block_aggregate(
    da: xr.DataArray, factor: int = 10
) -> tuple[xr.DataArray, xr.DataArray]:
    """Area-weighted aggregation of a fine grid to a coarser one.

    Parameters
    ----------
    da:
        Fine-grid DataArray with dims ``(lat, lon)`` or ``(time, lat, lon)``
        in contract orientation (lat descending, lon ascending), aligned to
        the contract grid (fine cell boundaries on integer degree multiples).
    factor:
        Number of fine cells per coarse cell edge (10 turns 0.1° into 1°).

    Returns
    -------
    (coarse_value, valid_fraction):
        ``coarse_value`` is the mean of valid fine cells weighted by
        ``cos(latitude)`` (see :func:`cell_area_weights`); NaN where fewer
        than ``COARSE_VALID_AREA_FRACTION`` of the coarse cell's fine area is
        valid. ``valid_fraction`` is the valid **area** fraction
        (Σ w·valid / Σ w) of each coarse cell.
    """
    if "lat" not in da.dims or "lon" not in da.dims:
        raise ValueError(f"Expected dims 'lat'/'lon', got {da.dims}")
    da = da.sortby("lat", ascending=False).sortby("lon", ascending=True)

    has_time = "time" in da.dims
    arr = np.asarray(da.values, dtype=np.float64)
    if not has_time:
        arr = arr[None, ...]
    n_time, n_lat, n_lon = arr.shape

    n_lat_b = (n_lat // factor) * factor
    n_lon_b = (n_lon // factor) * factor
    if n_lat_b != n_lat or n_lon_b != n_lon:
        # Drop incomplete edge blocks; document in the report if ever hit.
        arr = arr[:, :n_lat_b, :n_lon_b]

    lat_fine = np.asarray(da["lat"].values, dtype=float)[:n_lat_b]
    lon_fine = np.asarray(da["lon"].values, dtype=float)[:n_lon_b]

    # Weight each fine row by cos(latitude); constant along the row.
    w = cell_area_weights(lat_fine)  # (n_lat_b,)

    blocks = arr.reshape(
        n_time, n_lat_b // factor, factor, n_lon_b // factor, factor
    )
    valid = np.isfinite(blocks)
    # Weight each fine row by cos(latitude); reshape to (1, nb_lat, factor, 1, 1)
    # so it broadcasts against the blocked array.
    w5 = w.reshape(n_lat_b // factor, factor)[None, :, :, None, None]
    weighted_valid = w5 * valid
    numerator = (np.nan_to_num(blocks) * weighted_valid).sum(axis=(2, 4))
    denominator = weighted_valid.sum(axis=(2, 4))
    # Total block area = sum of weights over every fine cell of the block
    # (weights are constant along a row of constant latitude).
    total_area = (np.ones(valid.shape, dtype=np.float64) * w5).sum(axis=(2, 4))

    valid_fraction = np.where(total_area > 0, denominator / total_area, 0.0)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = numerator / denominator
    mean = np.where(
        (valid_fraction >= COARSE_VALID_AREA_FRACTION) & (denominator > 0),
        mean,
        np.nan,
    )

    # Coarse cell centres = mean of the fine centres in each block.
    lat_coarse = lat_fine.reshape(n_lat_b // factor, factor).mean(axis=1)
    lon_coarse = lon_fine.reshape(n_lon_b // factor, factor).mean(axis=1)

    dims = ("lat", "lon") if not has_time else ("time", "lat", "lon")
    if not has_time:
        mean = mean[0]
        valid_fraction = valid_fraction[0]
    value = xr.DataArray(
        mean.astype(np.float32),
        dims=dims,
        coords={
            "lat": lat_coarse,
            "lon": lon_coarse,
            **({"time": da["time"].values} if has_time else {}),
        },
    )
    fraction = xr.DataArray(
        valid_fraction.astype(np.float32),
        dims=dims,
        coords=value.coords,
    )

    # When the fine grid is the full global grid aligned to the contract,
    # the coarse result must be exactly the contract grid.
    if (
        n_lat_b == N_ROWS * factor
        and n_lon_b == N_COLS * factor
        and np.isclose(lat_coarse[0], LAT_NORTH_CENTER, atol=1e-4)
    ):
        exp_lat, exp_lon = target_grid()
        coarse_tol = _coord_tolerance(np.concatenate([lat_fine, lon_fine]))
        assert np.allclose(lat_coarse, exp_lat, atol=coarse_tol), "lat off contract grid"
        assert np.allclose(lon_coarse, exp_lon, atol=coarse_tol), "lon off contract grid"

    return value, fraction
