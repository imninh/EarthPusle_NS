"""P02 tests for earthpulse.grid (synthetic data only, no network)."""

from __future__ import annotations

import numpy as np
import pytest
import xarray as xr

from earthpulse import contract
from earthpulse.grid import (
    COARSE_VALID_AREA_FRACTION,
    block_aggregate,
    cell_area_weights,
    target_grid,
    to_contract_orientation,
)


def make_fine_grid(lat_center: float, lon_center: float, resolution: float = 0.1):
    """Full global 0.1°-style grids, lat ascending / lon ascending (IMERG order)."""
    n = int(round(180.0 / resolution))
    m = int(round(360.0 / resolution))
    lat = -90.0 + resolution / 2.0 + np.arange(n) * resolution  # ascending
    lon = -180.0 + resolution / 2.0 + np.arange(m) * resolution  # ascending
    return lat, lon


# ---------------------------------------------------------------------------
# target_grid / cell_area_weights
# ---------------------------------------------------------------------------


def test_target_grid_matches_contract():
    lat, lon = target_grid()
    assert lat.shape == (contract.N_ROWS,) and lon.shape == (contract.N_COLS,)
    assert lat[0] == pytest.approx(contract.LAT_NORTH_CENTER)
    assert lon[0] == pytest.approx(contract.LON_WEST_CENTER)
    assert lat[-1] == pytest.approx(-89.5) and lon[-1] == pytest.approx(179.5)
    assert np.all(np.diff(lat) < 0) and np.all(np.diff(lon) > 0)
    # Row/col helpers agree: lat 23.5 -> row 66, lon 12.5 -> col 192.
    assert contract.lat_to_row(23.5) == 66
    assert contract.lon_to_col(12.5) == 192
    assert lat[66] == pytest.approx(23.5) and lon[192] == pytest.approx(12.5)


def test_cell_area_weights_cos_lat():
    lat = np.array([-60.0, -30.0, 0.0, 30.0, 60.0])
    w = cell_area_weights(lat)
    assert w[2] == pytest.approx(1.0)  # maximum at the equator
    assert w[0] == pytest.approx(w[4])  # symmetric between hemispheres
    assert w[1] == pytest.approx(np.cos(np.deg2rad(30.0)))
    assert np.all((w > 0) & (w <= 1))


# ---------------------------------------------------------------------------
# to_contract_orientation
# ---------------------------------------------------------------------------


def _fine_dataarray(values=None, resolution=0.1, dims=("time", "lon", "lat")):
    """Synthetic IMERG-like array (time, lon, lat) with ascending coords."""
    lat, lon = make_fine_grid(0.0, 0.0, resolution)
    if values is None:
        values = np.zeros((1, lon.size, lat.size), dtype=np.float64)
    data = xr.DataArray(
        values,
        dims=list(dims),
        coords={"lon": lon, "lat": lat},
    )
    return data


def test_orientation_imerg_marker_lands_row_66_col_192():
    """A 0.1° marker at lat 23.55, lon 12.55 ends up in row 66, col 192."""
    da = _fine_dataarray()
    # Set the marker in (lon, lat) index space.
    lat_fine, lon_fine = da["lat"].values, da["lon"].values
    i_lat = int(np.argmin(np.abs(lat_fine - 23.55)))
    i_lon = int(np.argmin(np.abs(lon_fine - 12.55)))
    assert lat_fine[i_lat] == pytest.approx(23.55)
    assert lon_fine[i_lon] == pytest.approx(12.55)
    da.values[0, i_lon, i_lat] = 5.0  # dims are (time, lon, lat)

    oriented = to_contract_orientation(da)
    assert oriented.dims == ("time", "lat", "lon")
    assert np.all(np.diff(oriented["lat"].values) < 0)  # north-first
    assert np.all(np.diff(oriented["lon"].values) > 0)
    # The transposed array must keep the marker at its fine coordinates
    # (a positional lon/lat swap would fail here).
    assert float(
        oriented.sel(lat=23.55, lon=12.55, method="nearest").values[0]
    ) == pytest.approx(5.0)

    # A lone fine cell cannot pass the >= 50 % area-validity rule, so fill
    # the whole 1° block containing the marker to test its coarse position.
    filled = to_contract_orientation(_fine_dataarray())
    fl = filled["lat"].values  # descending after orientation
    flon = filled["lon"].values
    block_lat = (fl > 23.0) & (fl < 24.0)
    block_lon = (flon > 12.0) & (flon < 13.0)
    filled.values[0][
        np.ix_(np.where(block_lat)[0], np.where(block_lon)[0])
    ] = 5.0
    coarse, fraction = block_aggregate(filled)
    assert coarse.dims == ("time", "lat", "lon")
    assert coarse.shape == (1, contract.N_ROWS, contract.N_COLS)
    marker = coarse.values[0, 66, 192]
    assert marker == pytest.approx(5.0)
    assert contract.row_to_lat(66) == pytest.approx(23.5)
    assert contract.col_to_lon(192) == pytest.approx(12.5)


def test_orientation_gldas_150_rows_flip_and_nan_rows():
    """GLDAS-like 150-row ascending-lat array: flip into rows 0-149 of 180."""
    lat = -59.5 + np.arange(150) * 1.0  # ascending, centres -59.5..89.5
    lon = -179.5 + np.arange(360) * 1.0  # ascending
    data = np.full((1, 150, 360), np.nan)
    data[0, :, :] = np.arange(150)[:, None]  # row index as marker value
    da = xr.DataArray(
        data, dims=("time", "lat", "lon"), coords={"lat": lat, "lon": lon}
    )

    oriented = to_contract_orientation(da)
    assert oriented.shape == (1, contract.N_ROWS, contract.N_COLS)
    assert oriented["lat"].values[0] == pytest.approx(89.5)

    # Rows 0-149 hold the flipped GLDAS data; rows 150-179 are NaN.
    assert np.all(np.isfinite(oriented.values[0, :150, :]))
    assert np.all(np.isnan(oriented.values[0, 150:, :]))
    # The value that was at GLDAS lat 23.5 (row 83 of 150, ascending) is now
    # at contract row 66 (23.5 = 89.5 - 66).
    assert oriented.values[0, 66, 0] == pytest.approx(83.0)
    # Northmost GLDAS row (89.5) is contract row 0.
    assert oriented.values[0, 0, 0] == pytest.approx(149.0)


def test_orientation_rejects_misaligned_grid():
    """Coordinates not on the aligned global grid must raise, not shift."""
    lat = np.array([1.0, 0.0, -1.0])  # boundaries on .5 degrees, misaligned
    lon = np.array([0.0, 1.0])
    da = xr.DataArray(
        np.zeros((3, 2)), dims=("lat", "lon"), coords={"lat": lat, "lon": lon}
    )
    with pytest.raises(ValueError, match="align"):
        to_contract_orientation(da)


# ---------------------------------------------------------------------------
# block_aggregate
# ---------------------------------------------------------------------------


def _small_grid(data, lat, lon, factor=2):
    da = xr.DataArray(
        data, dims=("lat", "lon"), coords={"lat": lat, "lon": lon}
    )
    return da, factor


def test_block_aggregate_constant_field_returns_constant():
    lat = np.array([1.5, 0.5, -0.5, -1.5])  # descending, aligned to 1°
    lon = np.array([-1.5, -0.5, 0.5, 1.5])
    da = xr.DataArray(
        np.full((4, 4), 3.0), dims=("lat", "lon"), coords={"lat": lat, "lon": lon}
    )
    coarse, fraction = block_aggregate(da, factor=2)
    assert coarse.shape == (2, 2)
    assert np.allclose(coarse.values, 3.0)
    assert np.allclose(fraction.values, 1.0)


def test_block_aggregate_latitude_field_is_area_weighted():
    """A field equal to latitude aggregates to the cos(lat)-weighted mean."""
    lat = np.array([23.55, 23.45, 23.35, 23.25, 23.15, 23.05, 22.95, 22.85,
                    22.75, 22.65])  # descending 0.1° centres of one 1° cell
    lon = np.array([12.05, 12.15, 12.25, 12.35, 12.45, 12.55, 12.65, 12.75,
                    12.85, 12.95])
    data = np.repeat(lat[:, None], 10, axis=1)  # value = latitude
    da = xr.DataArray(data, dims=("lat", "lon"), coords={"lat": lat, "lon": lon})
    coarse, _ = block_aggregate(da, factor=10)
    plain_mean = float(np.mean(lat))
    weighted = float(np.sum(lat * cell_area_weights(lat)) / np.sum(cell_area_weights(lat)))
    result = float(coarse.values[0, 0])
    assert result == pytest.approx(weighted)
    assert result != pytest.approx(plain_mean)
    # cos(lat) shrinks towards the pole, so the weighted mean is further
    # south (smaller latitude) than the plain mean here.
    assert result < plain_mean


def test_block_aggregate_valid_fraction_threshold():
    """A coarse cell is valid only if >= 50 % of its area is valid."""
    lat = np.array([1.5, 0.5, -0.5, -1.5])
    lon = np.array([-1.5, -0.5, 0.5, 1.5])
    w = cell_area_weights(lat)

    # One NaN cell out of four in the first block: fraction ~0.75 -> valid.
    data = np.ones((4, 4))
    data[0, 0] = np.nan
    da = xr.DataArray(data, dims=("lat", "lon"), coords={"lat": lat, "lon": lon})
    coarse, fraction = block_aggregate(da, factor=2)
    expected = float(w[1:].sum() / w.sum())
    assert float(fraction.values[0, 0]) == pytest.approx(expected, abs=1e-6)
    assert np.isfinite(coarse.values[0, 0])

    # Three NaN cells: fraction ~0.25 -> NaN, below the documented threshold.
    data = np.ones((4, 4))
    data[:3, :2] = np.nan  # rows 0-2, cols 0-1 of block (0, 0)
    da = xr.DataArray(data, dims=("lat", "lon"), coords={"lat": lat, "lon": lon})
    coarse, fraction = block_aggregate(da, factor=2)
    assert float(fraction.values[0, 0]) < COARSE_VALID_AREA_FRACTION
    assert np.isnan(coarse.values[0, 0])
    # The neighbouring block (0, 1) keeps its full area and its value.
    assert np.isfinite(coarse.values[0, 1])
    assert fraction.values[0, 1] == pytest.approx(1.0)


def test_block_aggregate_fill_cells_never_enter_means():
    """Fill values must be NaN before aggregation and stay out of means."""
    lat = np.array([1.5, 0.5, -0.5, -1.5])
    lon = np.array([-1.5, -0.5, 0.5, 1.5])
    data = np.full((4, 4), 10.0)
    data[1, 1] = -9999.0  # pretend fill value
    data = np.where(data == -9999.0, np.nan, data)
    da = xr.DataArray(data, dims=("lat", "lon"), coords={"lat": lat, "lon": lon})
    coarse, _ = block_aggregate(da, factor=2)
    # If the fill had entered the mean, the result would be far below 10.
    assert np.allclose(coarse.values[np.isfinite(coarse.values)], 10.0)


def test_block_aggregate_time_dim_supported():
    lat = np.array([0.5, -0.5])
    lon = np.array([-0.5, 0.5])
    data = np.array([[[1.0, 1.0], [1.0, 1.0]], [[2.0, 2.0], [2.0, 2.0]]])
    time = np.array(["2001-01-01", "2001-02-01"], dtype="datetime64[ns]")
    da = xr.DataArray(
        data,
        dims=("time", "lat", "lon"),
        coords={"time": time, "lat": lat, "lon": lon},
    )
    coarse, fraction = block_aggregate(da, factor=2)
    assert coarse.shape == (2, 1, 1)
    assert coarse.values[0, 0, 0] == pytest.approx(1.0)
    assert coarse.values[1, 0, 0] == pytest.approx(2.0)
