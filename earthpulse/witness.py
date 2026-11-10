"""P13 witness harmonization helpers: conservative regridding, units, mask.

The witness products have different grids and units from the main EarthPulse
products. This module provides the small, testable pieces used by the P13
scripts; it does not modify the main P02/P03 code.

Regridding is a conservative area-weighted overlap: every fine source cell is
split by the contract 1° cell boundaries, weighted by its ``cos(latitude)``
area, and aggregated to the target cell. Missing source values do not enter the
numerator or denominator. The resulting weights are sparse so monthly cubes
are cheap to process.
"""

from __future__ import annotations

import calendar
from pathlib import Path
from typing import Any

import numpy as np
import scipy.sparse as sparse
import yaml

from earthpulse import contract

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "config" / "witnesses.yaml"

TARGET_LAT = contract.LAT_NORTH_CENTER - np.arange(
    contract.N_ROWS, dtype=float
) * contract.RESOLUTION_DEG
TARGET_LON = contract.LON_WEST_CENTER + np.arange(
    contract.N_COLS, dtype=float
) * contract.RESOLUTION_DEG


def load_witness_config(path: str | Path | None = None) -> dict[str, Any]:
    """Load ``config/witnesses.yaml``."""

    with open(path or DEFAULT_CONFIG_PATH, encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def convert_units(
    values: np.ndarray,
    conversion: str,
    year: int,
    month: int,
) -> np.ndarray:
    """Convert a witness field to its declared display unit.

    Supported conversions mirror the P02 rules plus the GPCP daily rate:
    ``identity``, ``kelvin_to_celsius``, ``kg_per_kg_to_g_per_kg``,
    ``per_second_to_per_month`` and ``per_day_to_per_month``.
    """

    array = np.asarray(values, dtype=float)
    if conversion == "identity":
        return array
    if conversion == "kelvin_to_celsius":
        return array - 273.15
    if conversion == "kg_per_kg_to_g_per_kg":
        return array * 1000.0
    if conversion == "per_second_to_per_month":
        seconds = calendar.monthrange(year, month)[1] * 86400.0
        return array * seconds
    if conversion == "per_day_to_per_month":
        days = calendar.monthrange(year, month)[1]
        return array * float(days)
    raise ValueError(f"Unknown witness conversion {conversion!r}")


def _edges(coordinates: np.ndarray, clip_lat: bool = False) -> np.ndarray:
    """Cell boundaries from monotonic cell-centre coordinates."""

    coords = np.asarray(coordinates, dtype=float)
    if coords.size < 2:
        raise ValueError("Need at least two coordinate values")
    if np.all(np.diff(coords) > 0):
        mids = (coords[:-1] + coords[1:]) / 2.0
        edges = np.r_[
            coords[0] - (mids[0] - coords[0]),
            mids,
            coords[-1] + (coords[-1] - mids[-1]),
        ]
    elif np.all(np.diff(coords) < 0):
        mids = (coords[:-1] + coords[1:]) / 2.0
        edges = np.r_[
            coords[0] + (coords[0] - mids[0]),
            mids,
            coords[-1] - (mids[-1] - coords[-1]),
        ]
    else:
        raise ValueError("Coordinate array is not monotonic")
    if clip_lat:
        edges = np.clip(edges, -90.0, 90.0)
    return edges


def _split_dateline(low: float, high: float) -> list[tuple[float, float]]:
    """Split a longitude interval at ±180 into in-range pieces."""

    pieces: list[tuple[float, float]] = []
    if high > 180.0:
        pieces.append((max(low, -180.0), 180.0))
        pieces.append((-180.0, high - 360.0))
    elif low < -180.0:
        pieces.append((low + 360.0, 180.0))
        pieces.append((-180.0, min(high, 180.0)))
    else:
        pieces.append((max(low, -180.0), min(high, 180.0)))
    return [(a, b) for a, b in pieces if b > a]


def build_overlap_weights(
    source_lat: np.ndarray,
    source_lon: np.ndarray,
) -> sparse.csr_matrix:
    """Sparse target×source overlap weights for the contract 1° grid.

    ``weights[target_flat, source_flat]`` is the area of the overlap (relative;
    the row-normalized result is an area-weighted mean). A source cell that
    crosses the dateline is split into two pieces.
    """

    lat = np.asarray(source_lat, dtype=float)
    lon = np.asarray(source_lon, dtype=float)
    lat_edges = _edges(lat, clip_lat=True)
    lon_edges = _edges(lon, clip_lat=False)

    rows: list[int] = []
    cols: list[int] = []
    data: list[float] = []

    for i_lat in range(lat.size):
        low_lat, high_lat = sorted((lat_edges[i_lat], lat_edges[i_lat + 1]))
        if high_lat <= low_lat:
            continue
        row0 = max(0, int(np.ceil(89.0 - high_lat)))
        row1 = min(contract.N_ROWS - 1, int(np.floor(90.0 - low_lat)))
        if row0 > row1:
            continue
        area_lat = np.cos(np.deg2rad(lat[i_lat]))

        for j_lon in range(lon.size):
            low_lon, high_lon = sorted((lon_edges[j_lon], lon_edges[j_lon + 1]))
            pieces = _split_dateline(low_lon, high_lon)
            if not pieces:
                continue
            source_flat = i_lat * lon.size + j_lon
            for piece_low, piece_high in pieces:
                col0 = max(0, int(np.ceil(piece_low + 179.0)))
                col1 = min(contract.N_COLS - 1, int(np.floor(piece_high + 180.0)))
                if col0 > col1:
                    continue
                for row in range(row0, row1 + 1):
                    target_low_lat = 89.0 - row
                    target_high_lat = 90.0 - row
                    overlap_lat = max(
                        0.0,
                        min(high_lat, target_high_lat)
                        - max(low_lat, target_low_lat),
                    )
                    if overlap_lat <= 0:
                        continue
                    for col in range(col0, col1 + 1):
                        target_low_lon = -180.0 + col
                        target_high_lon = -179.0 + col
                        overlap_lon = max(
                            0.0,
                            min(piece_high, target_high_lon)
                            - max(piece_low, target_low_lon),
                        )
                        if overlap_lon <= 0:
                            continue
                        rows.append(row * contract.N_COLS + col)
                        cols.append(source_flat)
                        data.append(area_lat * overlap_lat * overlap_lon)

    return sparse.csr_matrix(
        (data, (rows, cols)),
        shape=(contract.N_ROWS * contract.N_COLS, lat.size * lon.size),
        dtype=np.float64,
    )


def area_weighted_regrid(
    values: np.ndarray,
    weights: sparse.csr_matrix,
    source_shape: tuple[int, int],
) -> np.ndarray:
    """Conservatively regrid one or more source fields to the contract grid.

    Args:
        values: ``(lat, lon)`` or ``(time, lat, lon)`` source values.
        weights: result of :func:`build_overlap_weights`.
        source_shape: ``(n_lat, n_lon)``.

    Returns:
        ``(180, 360)`` or ``(time, 180, 360)`` float64 array with NaN where no
        valid source area overlaps the target cell.
    """

    array = np.asarray(values, dtype=float)
    if array.ndim == 2:
        array = array[None, ...]
    if array.ndim != 3 or array.shape[1:] != source_shape:
        raise ValueError(
            f"values must be (..., {source_shape[0]}, {source_shape[1]})"
        )

    n_time = array.shape[0]
    numerator = np.empty((n_time, contract.N_ROWS * contract.N_COLS), dtype=float)
    denominator = np.empty_like(numerator)
    for index in range(n_time):
        flat = array[index].ravel()
        valid = np.isfinite(flat)
        numerator[index] = weights @ np.where(valid, flat, 0.0)
        denominator[index] = weights @ valid.astype(float)

    with np.errstate(invalid="ignore", divide="ignore"):
        result = np.where(denominator > 0, numerator / denominator, np.nan)
    result = result.reshape(
        n_time, contract.N_ROWS, contract.N_COLS
    )
    return result[0] if np.asarray(values).ndim == 2 else result


def apply_mask(values: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Set cells outside the common mask to NaN."""

    array = np.asarray(values, dtype=float)
    domain = np.asarray(mask, dtype=bool)
    if domain.shape != (contract.N_ROWS, contract.N_COLS):
        raise ValueError("mask must have the contract 180x360 shape")
    if array.shape[-2:] != domain.shape:
        raise ValueError("values must end in the contract 180x360 shape")
    return np.where(domain, array, np.nan)
