"""Automatic, evidence-backed Detective Cases (contract section 9).

This module turns the P03 per-cell trend grids into a small, contrasting set
of *real* cases.  It is deliberately split into pure functions over
contract-shaped NumPy arrays and a thin CLI/IO layer in
``scripts/p06_cases.py`` so that the selection rules can be tested without
touching real EarthPulse data.

Selection follows ``docs/packages/specs/P06_detective_cases.md``:

1. For each variable x window, cells with the same significant trend class
   (+1 or -1) are grouped into 8-neighbour connected clusters.  Clusters with
   fewer than :data:`DEFAULT_MIN_CLUSTER_CELLS` eligible cells are dropped.
2. Cells with ``quality_flag >= 1`` (schema 1.2, when the layer exists) are
   excluded before the minimum-area test and the remaining flag share
   penalises the score.
3. ``score = area x median |standardized change| x (1 - flag share)`` where
   ``area`` is the sum of ``cos(latitude)`` cell weights.
4. The selected set tries to cover an IMERG precipitation case, an
   opposite-direction pair for one variable, a multi-variable pattern case
   (warming + drying preferred) and a Southeast Asia / Mekong case.  The
   remaining slots are filled with the highest-scoring distinct
   variable/window candidates.
5. Country-level candidates are evaluated when a schema 1.2 country grid is
   available.

Every number in the output comes from the input grids.  ``config/cases.yaml``
may only change wording (titles and ``why_selected``), never numbers.
"""

from __future__ import annotations

import json
import math
from collections import deque
from pathlib import Path
from typing import Iterable, Mapping, Sequence

import numpy as np

from earthpulse import contract
from earthpulse.patterns import pattern_class
from earthpulse.screener import weighted_median

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TRENDS_DIR = PROJECT_ROOT / "data" / "processed" / "trends"
DEFAULT_ANOMALY_DIR = PROJECT_ROOT / "data" / "processed" / "anomalies"
DEFAULT_EXPORT_DIR = PROJECT_ROOT / "data" / "export" / "web_data"
DEFAULT_REGISTRY_PATH = PROJECT_ROOT / "config" / "variables.yaml"
DEFAULT_REGIONS_PATH = PROJECT_ROOT / "config" / "regions.yaml"
DEFAULT_CASES_CONFIG_PATH = PROJECT_ROOT / "config" / "cases.yaml"

DEFAULT_MIN_CLUSTER_CELLS = 15
DEFAULT_MAX_CASES = 6
DEFAULT_TARGET_CASES = 4
DEFAULT_PRECIPITATION_VARIABLE = "precipitation"
DEFAULT_PLACE_REGION_IDS = ("mekong", "southeast_asia")

EVIDENCE_METHOD = (
    "Sen's slope + Hamed-Rao modified Mann-Kendall + BH-FDR"
)

DEFAULT_SELECTION_METHOD = (
    "Deterministic selection from computed P03 grids (no hand-picked values). "
    "For each variable x window, cells with the same significant trend class "
    "(+1 or -1, BH-FDR q < q_threshold) are grouped into 8-neighbour connected "
    "clusters; clusters with fewer than the documented minimum of eligible "
    "cells are dropped and cells with quality_flag >= 1 (schema 1.2, when the "
    "layer exists) are excluded. Candidates are scored as area (sum of "
    "cos(latitude) weights) x median |standardized change per decade| x "
    "(1 - quality-flag share). The selected set covers, when the evidence "
    "supports it, (a) an IMERG precipitation case, (b) both directions of the "
    "strongest same-variable opposite-direction pair, (c) a multi-variable "
    "pattern case (warming + drying preferred), and (d) the strongest "
    "Southeast Asia / Mekong case; remaining slots are filled with the "
    "highest-scoring distinct variable/window candidates. Country-level "
    "candidates are added when a schema 1.2 country grid is present. Every "
    "evidence number is an area-weighted aggregate of the underlying cell "
    "grids."
)

_EVALUATED_CLASSES = (
    contract.TREND_DECREASE,
    contract.TREND_NOT_SIGNIFICANT,
    contract.TREND_INCREASE,
)
_SIGNIFICANT_CLASSES = (contract.TREND_DECREASE, contract.TREND_INCREASE)
_PATTERN_WORDING = {
    contract.PATTERN_WARMING_DRYING: "warming and drying together",
    contract.PATTERN_WARMING_WETTING: "warming and wetting together",
    contract.PATTERN_COOLING_DRYING: "cooling and drying together",
    contract.PATTERN_COOLING_WETTING: "cooling and wetting together",
}
_EIGHT_NEIGHBOURS = (
    (-1, -1), (-1, 0), (-1, 1),
    (0, -1), (0, 1),
    (1, -1), (1, 0), (1, 1),
)
_FOUR_NEIGHBOURS = ((-1, 0), (0, -1), (0, 1), (1, 0))


# ---------------------------------------------------------------------------
# Small grid helpers
# ---------------------------------------------------------------------------


def latitude_weights() -> np.ndarray:
    """Return the ``cos(lat)`` weight of every contract grid row."""

    rows = np.arange(contract.N_ROWS, dtype=float)
    latitudes = contract.LAT_NORTH_CENTER - rows * contract.RESOLUTION_DEG
    return np.cos(np.deg2rad(latitudes))


def _require_contract_shape(name: str, array: np.ndarray) -> np.ndarray:
    result = np.asarray(array)
    expected = (contract.N_ROWS, contract.N_COLS)
    if result.shape != expected:
        raise ValueError(f"{name} must have shape {expected}, got {result.shape}")
    return result


def _weighted_mean(values: np.ndarray, weights: np.ndarray) -> float | None:
    values_array = np.asarray(values, dtype=float).ravel()
    weights_array = np.asarray(weights, dtype=float).ravel()
    keep = (
        np.isfinite(values_array)
        & np.isfinite(weights_array)
        & (weights_array > 0.0)
    )
    if not np.any(keep):
        return None
    total = float(weights_array[keep].sum())
    if total <= 0.0:
        return None
    return float((values_array[keep] * weights_array[keep]).sum() / total)


def _round(value: float | int | None, digits: int = 6) -> float | None:
    if value is None:
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    result = round(number, digits)
    return 0.0 if result == 0.0 else float(result)


def _bbox_mask(bbox: Sequence[float]) -> np.ndarray:
    """Boolean mask of cell centres inside ``[west, south, east, north]``."""

    west, south, east, north = (float(value) for value in bbox)
    rows = np.arange(contract.N_ROWS, dtype=float)
    latitudes = contract.LAT_NORTH_CENTER - rows * contract.RESOLUTION_DEG
    cols = np.arange(contract.N_COLS, dtype=float)
    longitudes = contract.LON_WEST_CENTER + cols * contract.RESOLUTION_DEG

    inside_lat = (latitudes >= south) & (latitudes <= north)
    if west <= east:
        inside_lon = (longitudes >= west) & (longitudes <= east)
    else:  # crosses the antimeridian
        inside_lon = (longitudes >= west) | (longitudes <= east)
    return inside_lat[:, None] & inside_lon[None, :]


def _point_in_bbox(latitude: float, longitude: float, bbox: Sequence[float]) -> bool:
    west, south, east, north = (float(value) for value in bbox)
    if not (south <= latitude <= north):
        return False
    if west <= east:
        return west <= longitude <= east
    return longitude >= west or longitude <= east


def _bbox_intersects(a: Sequence[float], b: Sequence[float]) -> bool:
    """Approximate intersection test for two lon/lat boxes (dateline aware)."""

    _, south_a, _, north_a = (float(value) for value in a)
    _, south_b, _, north_b = (float(value) for value in b)
    if north_a < south_b or north_b < south_a:
        return False

    def _lon_ranges(box: Sequence[float]) -> list[tuple[float, float]]:
        west, _, east, _ = (float(value) for value in box)
        if west <= east:
            return [(west, east)]
        return [(west, 180.0), (-180.0, east)]

    return any(
        not (east_a < west_b or east_b < west_a)
        for west_a, east_a in _lon_ranges(a)
        for west_b, east_b in _lon_ranges(b)
    )


def _lon_ranges(box: Sequence[float]) -> list[tuple[float, float]]:
    west, _, east, _ = (float(value) for value in box)
    if west <= east:
        return [(west, east)]
    return [(west, 180.0), (-180.0, east)]


def _bbox_contains(outer: Sequence[float], inner: Sequence[float]) -> bool:
    _, south_o, _, north_o = (float(value) for value in outer)
    _, south_i, _, north_i = (float(value) for value in inner)
    if south_i < south_o or north_i > north_o:
        return False
    inner_ranges = _lon_ranges(inner)
    outer_ranges = _lon_ranges(outer)
    return all(
        any(west_o <= west_i and east_i <= east_o for west_o, east_o in outer_ranges)
        for west_i, east_i in inner_ranges
    )


def _bbox_overlap_fraction(inner: Sequence[float], outer: Sequence[float]) -> float:
    """Fraction of ``inner``'s bbox area that falls inside ``outer``."""

    _, south_i, _, north_i = (float(value) for value in inner)
    _, south_o, _, north_o = (float(value) for value in outer)
    lat_overlap = max(0.0, min(north_i, north_o) - max(south_i, south_o))
    lon_overlap = 0.0
    for west_i, east_i in _lon_ranges(inner):
        for west_o, east_o in _lon_ranges(outer):
            lon_overlap += max(0.0, min(east_i, east_o) - max(west_i, west_o))
    lat_height = max(0.0, north_i - south_i)
    lon_width = sum(east - west for west, east in _lon_ranges(inner))
    area = lat_height * lon_width
    if area <= 0.0:
        return 0.0
    return (lat_overlap * lon_overlap) / area


def _bbox_and_center(rows: np.ndarray, cols: np.ndarray) -> tuple[list[float], tuple[float, float]]:
    """Bounding box and centre of a set of cell centres (dateline aware)."""

    latitudes = contract.LAT_NORTH_CENTER - np.asarray(rows, dtype=float) * contract.RESOLUTION_DEG
    longitudes = contract.LON_WEST_CENTER + np.asarray(cols, dtype=float) * contract.RESOLUTION_DEG
    if latitudes.size == 0:
        raise ValueError("cannot compute a bbox for an empty cell set")

    south = max(-90.0, float(latitudes.min()) - 0.5 * contract.RESOLUTION_DEG)
    north = min(90.0, float(latitudes.max()) + 0.5 * contract.RESOLUTION_DEG)

    unique_lons = np.unique(longitudes)
    if unique_lons.size == 1:
        west = float(unique_lons[0]) - 0.5 * contract.RESOLUTION_DEG
        east = float(unique_lons[0]) + 0.5 * contract.RESOLUTION_DEG
    else:
        gaps = np.diff(np.concatenate([unique_lons, [unique_lons[0] + 360.0]]))
        gap_index = int(np.argmax(gaps))
        start = float(unique_lons[(gap_index + 1) % unique_lons.size])
        end = float(unique_lons[gap_index])
        west = start - 0.5 * contract.RESOLUTION_DEG
        east = end + 0.5 * contract.RESOLUTION_DEG
        if west < -180.0:
            west += 360.0
        if east > 180.0:
            east -= 360.0
        if west > 180.0:
            west -= 360.0
        if east < -180.0:
            east += 360.0

    if west <= east:
        center_lon = 0.5 * (west + east)
    else:
        center_lon = 0.5 * (west + east + 360.0)
        if center_lon > 180.0:
            center_lon -= 360.0
    center_lat = 0.5 * (south + north)

    bbox = [
        _round(west) or 0.0,
        _round(south) or 0.0,
        _round(east) or 0.0,
        _round(north) or 0.0,
    ]
    return bbox, (center_lat, center_lon)


def place_label(
    latitude: float,
    longitude: float,
    regions: Sequence[Mapping] = (),
) -> str:
    """Human-readable place label for a point (smallest containing region)."""

    matches: list[tuple[float, str]] = []
    for region in regions:
        bbox = region.get("bbox")
        if not bbox:
            continue
        if not _point_in_bbox(latitude, longitude, bbox):
            continue
        west, south, east, north = (float(value) for value in bbox)
        width = east - west if east >= west else east + 360.0 - west
        area = width * (north - south)
        label = str(region.get("label") or region.get("id") or "region")
        matches.append((area, label))
    if matches:
        return min(matches, key=lambda item: (item[0], item[1]))[1]

    lat_word = "N" if latitude >= 0 else "S"
    lon_word = "E" if longitude >= 0 else "W"
    return f"{abs(latitude):.0f}\N{DEGREE SIGN}{lat_word}, {abs(longitude):.0f}\N{DEGREE SIGN}{lon_word}"


# ---------------------------------------------------------------------------
# Connected clusters and candidate scoring
# ---------------------------------------------------------------------------


def cluster_components(
    mask: np.ndarray,
    *,
    connectivity: int = 8,
    wrap_longitude: bool = True,
) -> list[np.ndarray]:
    """Connected components of a boolean grid, in row-major discovery order.

    ``connectivity`` is 4 or 8.  With ``wrap_longitude`` (the default) columns
    0 and ``n_cols - 1`` are neighbours, which is correct for the global grid.
    The returned masks are new arrays and do not share memory with ``mask``.
    """

    grid = np.asarray(mask, dtype=bool)
    if grid.ndim != 2:
        raise ValueError(f"mask must be 2-D, got shape {grid.shape}")
    if connectivity == 8:
        offsets = _EIGHT_NEIGHBOURS
    elif connectivity == 4:
        offsets = _FOUR_NEIGHBOURS
    else:
        raise ValueError("connectivity must be 4 or 8")

    n_rows, n_cols = grid.shape
    visited = np.zeros_like(grid, dtype=bool)
    components: list[np.ndarray] = []

    for row, col in np.argwhere(grid):
        row = int(row)
        col = int(col)
        if visited[row, col]:
            continue
        visited[row, col] = True
        queue: deque[tuple[int, int]] = deque([(row, col)])
        cells: list[tuple[int, int]] = []
        while queue:
            current_row, current_col = queue.popleft()
            cells.append((current_row, current_col))
            for delta_row, delta_col in offsets:
                next_row = current_row + delta_row
                next_col = current_col + delta_col
                if next_row < 0 or next_row >= n_rows:
                    continue
                if wrap_longitude:
                    next_col %= n_cols
                elif next_col < 0 or next_col >= n_cols:
                    continue
                if grid[next_row, next_col] and not visited[next_row, next_col]:
                    visited[next_row, next_col] = True
                    queue.append((next_row, next_col))

        component = np.zeros_like(grid, dtype=bool)
        for cell_row, cell_col in cells:
            component[cell_row, cell_col] = True
        components.append(component)

    return components


def _layer_stats(
    layers: Mapping[str, np.ndarray],
    cells: np.ndarray,
    weights: np.ndarray,
    trend_class: int,
    flagged_fraction: float,
    quality_available: bool,
) -> dict:
    """Area-weighted evidence numbers for one cell set."""

    rows, cols = np.nonzero(cells)
    cell_weights = weights[rows]

    def _median(name: str, transform=None) -> float | None:
        values = np.asarray(layers[name], dtype=float)[rows, cols]
        if transform is not None:
            values = transform(values)
        return weighted_median(values, cell_weights)

    sen_slope = _median("sen_slope_decade")
    std_change = _median("std_change_decade", np.abs)
    q_value = _median("q_value")
    p_value = _median("p_value")
    valid_observations = _median("n_valid")
    coverage = _weighted_mean(
        np.asarray(layers["coverage"], dtype=float)[rows, cols], cell_weights
    )

    return {
        "trend_class": int(trend_class),
        "sen_slope_decade": sen_slope,
        "std_change_decade": std_change,
        "q_value": q_value,
        "p_value": p_value,
        "valid_observations": valid_observations,
        "coverage_fraction": coverage,
        "quality_flag_fraction": flagged_fraction,
        "quality_available": quality_available,
    }


def _make_candidate(
    *,
    kind: str,
    variable: str,
    variables: Sequence[str],
    window: str,
    trend_class: int,
    component: np.ndarray,
    eligible: np.ndarray,
    flagged: np.ndarray,
    layers_by_variable: Mapping[str, Mapping[str, np.ndarray]],
    evaluated: np.ndarray,
    weights: np.ndarray,
    regions: Sequence[Mapping],
    quality_available: bool,
    pattern_code: int | None = None,
    country: Mapping | None = None,
    evidence_classes: Mapping[str, int] | None = None,
) -> dict | None:
    eligible_cells = int(eligible.sum())
    if eligible_cells == 0:
        return None

    rows, cols = np.nonzero(eligible)
    bbox, center = _bbox_and_center(rows, cols)
    label = (
        str(country.get("label"))
        if country is not None and country.get("label")
        else place_label(center[0], center[1], regions)
    )

    flagged_fraction = float(flagged.sum() / max(1, int(component.sum())))

    evidence = []
    area_weight = float(weights[rows].sum())
    for variable_id in variables:
        stats = _layer_stats(
            layers_by_variable[variable_id],
            eligible,
            weights,
            (evidence_classes or {}).get(variable_id, trend_class),
            flagged_fraction,
            quality_available,
        )
        stats["variable"] = variable_id
        evidence.append(stats)

    if kind == "pattern":
        std_values = [
            abs(stats["std_change_decade"])
            for stats in evidence
            if stats["std_change_decade"] is not None
        ]
        score_base = min(std_values) if std_values else 0.0
    else:
        score_base = abs(evidence[0]["std_change_decade"] or 0.0)

    bbox_eval = _bbox_mask(bbox) & evaluated
    significant_share = float(eligible_cells / max(1, int(bbox_eval.sum())))
    score = area_weight * score_base * (1.0 - flagged_fraction)

    candidate = {
        "kind": kind,
        "variable": variable,
        "variables": list(variables),
        "window": window,
        "trend_class": int(trend_class),
        "pattern_code": pattern_code,
        "country_id": country.get("id") if country is not None else None,
        "rows": rows,
        "cols": cols,
        "cells": eligible_cells,
        "component_cells": int(component.sum()),
        "area_weight": area_weight,
        "flagged_fraction": flagged_fraction,
        "quality_available": quality_available,
        "bbox": bbox,
        "center": center,
        "label": label,
        "score": float(score),
        "significant_share": significant_share,
        "evidence": evidence,
        "candidate_id": (
            f"{kind}:{variable}:{window}:{trend_class}:"
            f"{int(rows.min())}:{int(cols.min())}:"
            f"{pattern_code if pattern_code is not None else ''}"
        ),
    }
    return candidate


def trend_candidates(
    layers: Mapping[str, np.ndarray],
    variable: str,
    window: str,
    *,
    mask: np.ndarray | None = None,
    quality_flag: np.ndarray | None = None,
    min_cluster_cells: int = DEFAULT_MIN_CLUSTER_CELLS,
    regions: Sequence[Mapping] = (),
) -> list[dict]:
    """Build scored candidates from one variable x window trend grid."""

    required = (
        "trend_class",
        "sen_slope_decade",
        "std_change_decade",
        "q_value",
        "p_value",
        "n_valid",
        "coverage",
    )
    missing = [name for name in required if name not in layers]
    if missing:
        raise KeyError(f"{variable!r}/{window!r} is missing layers: {missing}")
    if min_cluster_cells < 1:
        raise ValueError("min_cluster_cells must be at least 1")

    classes = _require_contract_shape("trend_class", layers["trend_class"])
    if mask is None:
        allowed = np.ones(classes.shape, dtype=bool)
    else:
        allowed = _require_contract_shape("mask", mask).astype(bool, copy=False)
    evaluated = allowed & np.isin(classes, _EVALUATED_CLASSES)
    weights = latitude_weights()

    if quality_flag is not None:
        quality = _require_contract_shape("quality_flag", quality_flag)
    else:
        quality = None

    candidates: list[dict] = []
    for trend_class in (contract.TREND_INCREASE, contract.TREND_DECREASE):
        class_cells = allowed & (classes == trend_class)
        for component in cluster_components(class_cells):
            if quality is not None:
                flagged = component & (quality >= 1)
            else:
                flagged = np.zeros_like(component)
            eligible = component & ~flagged
            candidate = _make_candidate(
                kind="global",
                variable=variable,
                variables=(variable,),
                window=window,
                trend_class=trend_class,
                component=component,
                eligible=eligible,
                flagged=flagged,
                layers_by_variable={variable: layers},
                evaluated=evaluated,
                weights=weights,
                regions=regions,
                quality_available=quality is not None,
            )
            if candidate is not None and candidate["cells"] >= min_cluster_cells:
                candidates.append(candidate)
    return candidates


def _dominant_class(
    layers: Mapping[str, np.ndarray], cells: np.ndarray
) -> int:
    """Dominant significant trend class among ``cells`` (defaults to +1)."""

    classes = np.asarray(layers["trend_class"])[cells]
    increasing = int(np.count_nonzero(classes == contract.TREND_INCREASE))
    decreasing = int(np.count_nonzero(classes == contract.TREND_DECREASE))
    return contract.TREND_INCREASE if increasing >= decreasing else contract.TREND_DECREASE


def pattern_candidates(
    layers_by_variable: Mapping[str, Mapping[str, np.ndarray]],
    temperature_variable: str,
    moisture_variable: str,
    window: str,
    *,
    pattern_layer: np.ndarray | None = None,
    mask: np.ndarray | None = None,
    quality_flags: Mapping[str, np.ndarray] | None = None,
    pattern_codes: Iterable[int] = (
        contract.PATTERN_WARMING_DRYING,
        contract.PATTERN_WARMING_WETTING,
        contract.PATTERN_COOLING_DRYING,
        contract.PATTERN_COOLING_WETTING,
    ),
    min_cluster_cells: int = DEFAULT_MIN_CLUSTER_CELLS,
    regions: Sequence[Mapping] = (),
) -> list[dict]:
    """Build multi-variable candidates from the core pattern classes."""

    if temperature_variable not in layers_by_variable:
        raise KeyError(f"missing temperature layers for {temperature_variable!r}")
    if moisture_variable not in layers_by_variable:
        raise KeyError(f"missing moisture layers for {moisture_variable!r}")

    temperature = _require_contract_shape(
        "temperature trend_class",
        layers_by_variable[temperature_variable]["trend_class"],
    )
    moisture = _require_contract_shape(
        "moisture trend_class",
        layers_by_variable[moisture_variable]["trend_class"],
    )
    if pattern_layer is None:
        pattern = pattern_class(temperature, moisture)
    else:
        pattern = _require_contract_shape("pattern_class", pattern_layer)

    if mask is None:
        allowed = np.ones(temperature.shape, dtype=bool)
    else:
        allowed = _require_contract_shape("mask", mask).astype(bool, copy=False)
    allowed = (
        allowed
        & np.isin(temperature, _EVALUATED_CLASSES)
        & np.isin(moisture, _EVALUATED_CLASSES)
    )
    weights = latitude_weights()

    quality_flags = quality_flags or {}
    quality_temp = (
        _require_contract_shape("temperature quality_flag", quality_flags[temperature_variable])
        if temperature_variable in quality_flags
        else None
    )
    quality_moist = (
        _require_contract_shape("moisture quality_flag", quality_flags[moisture_variable])
        if moisture_variable in quality_flags
        else None
    )
    quality_available = quality_temp is not None and quality_moist is not None

    candidates: list[dict] = []
    for pattern_code in pattern_codes:
        pattern_code = int(pattern_code)
        if pattern_code not in _PATTERN_WORDING:
            raise ValueError(f"unsupported pattern code {pattern_code}")
        class_cells = allowed & (pattern == pattern_code)
        for component in cluster_components(class_cells):
            flagged = np.zeros_like(component)
            if quality_temp is not None:
                flagged |= component & (quality_temp >= 1)
            if quality_moist is not None:
                flagged |= component & (quality_moist >= 1)
            eligible = component & ~flagged
            candidate = _make_candidate(
                kind="pattern",
                variable=f"{temperature_variable}+{moisture_variable}",
                variables=(temperature_variable, moisture_variable),
                window=window,
                trend_class=0,
                component=component,
                eligible=eligible,
                flagged=flagged,
                layers_by_variable={
                    temperature_variable: layers_by_variable[temperature_variable],
                    moisture_variable: layers_by_variable[moisture_variable],
                },
                evaluated=allowed,
                weights=weights,
                regions=regions,
                quality_available=quality_available,
                pattern_code=pattern_code,
                evidence_classes={
                    temperature_variable: _dominant_class(
                        layers_by_variable[temperature_variable], eligible
                    ),
                    moisture_variable: _dominant_class(
                        layers_by_variable[moisture_variable], eligible
                    ),
                },
            )
            if candidate is not None and candidate["cells"] >= min_cluster_cells:
                candidates.append(candidate)
    return candidates


def country_candidates(
    layers_by_variable: Mapping[str, Mapping[str, np.ndarray]],
    country_grid: np.ndarray,
    countries: Sequence[Mapping],
    window: str,
    *,
    mask: np.ndarray | None = None,
    quality_flags: Mapping[str, np.ndarray] | None = None,
    min_cells: int = DEFAULT_MIN_CLUSTER_CELLS,
    regions: Sequence[Mapping] = (),
) -> list[dict]:
    """Aggregate candidates for schema 1.2 country domains.

    A country is considered for a variable when at least ``min_cells`` cells
    are evaluated inside the common mask, at least half of them have a
    significant trend, and the majority direction has at least ``min_cells``
    cells.  Only the majority-direction significant cells enter the evidence.
    """

    grid = _require_contract_shape("country_grid", country_grid)
    quality_flags = quality_flags or {}
    weights = latitude_weights()
    if mask is None:
        default_allowed = np.ones(grid.shape, dtype=bool)
    else:
        default_allowed = _require_contract_shape("mask", mask).astype(bool, copy=False)

    candidates: list[dict] = []
    for country in countries:
        index = int(country.get("index", contract.COUNTRY_NONE))
        if index == contract.COUNTRY_NONE:
            continue
        country_cells = grid == index
        if not np.any(country_cells):
            continue
        for variable, layers in layers_by_variable.items():
            classes = _require_contract_shape("trend_class", layers["trend_class"])
            allowed = default_allowed & country_cells
            evaluated = allowed & np.isin(classes, _EVALUATED_CLASSES)
            if int(evaluated.sum()) < min_cells:
                continue
            quality = quality_flags.get(variable)
            if quality is not None:
                quality = _require_contract_shape("quality_flag", quality)
                flagged = evaluated & (quality >= 1)
            else:
                flagged = np.zeros_like(evaluated)
            eligible = evaluated & ~flagged
            if int(eligible.sum()) < min_cells:
                continue
            significant = eligible & np.isin(classes, _SIGNIFICANT_CLASSES)
            significant_cells = int(significant.sum())
            if significant_cells == 0:
                continue
            significant_share = significant_cells / max(1, int(eligible.sum()))
            if significant_share < 0.5:
                continue
            increasing = significant & (classes == contract.TREND_INCREASE)
            decreasing = significant & (classes == contract.TREND_DECREASE)
            trend_class = (
                contract.TREND_INCREASE
                if int(increasing.sum()) >= int(decreasing.sum())
                else contract.TREND_DECREASE
            )
            majority = significant & (classes == trend_class)
            if int(majority.sum()) < min_cells:
                continue
            candidate = _make_candidate(
                kind="country",
                variable=variable,
                variables=(variable,),
                window=window,
                trend_class=trend_class,
                component=allowed,
                eligible=majority,
                flagged=flagged,
                layers_by_variable={variable: layers},
                evaluated=allowed & np.isin(classes, _EVALUATED_CLASSES),
                weights=weights,
                regions=regions,
                quality_available=quality is not None,
                country=country,
            )
            if candidate is not None:
                candidate["score"] *= significant_share
                candidates.append(candidate)
    return candidates


# ---------------------------------------------------------------------------
# Selection and case formatting
# ---------------------------------------------------------------------------


def _candidate_key(candidate: Mapping) -> tuple:
    return (
        candidate.get("kind"),
        candidate.get("variable"),
        candidate.get("window"),
        int(candidate.get("trend_class", 0)),
        tuple(candidate.get("bbox", ())),
        candidate.get("pattern_code"),
        candidate.get("country_id"),
    )


def _rank_key(candidate: Mapping) -> tuple:
    return (
        -float(candidate.get("score", 0.0)),
        str(candidate.get("kind", "")),
        str(candidate.get("variable", "")),
        str(candidate.get("window", "")),
        int(candidate.get("trend_class", 0)),
        tuple(candidate.get("bbox", ())),
        int(candidate.get("pattern_code") or 0),
    )


def _region_box(regions: Sequence[Mapping], region_id: str) -> Sequence[float] | None:
    for region in regions:
        if region.get("id") == region_id and region.get("bbox"):
            return region["bbox"]
    return None


def select_cases(
    candidates: Sequence[Mapping],
    *,
    max_cases: int = DEFAULT_MAX_CASES,
    target_cases: int = DEFAULT_TARGET_CASES,
    precipitation_variable: str = DEFAULT_PRECIPITATION_VARIABLE,
    regions: Sequence[Mapping] = (),
    place_region_ids: Sequence[str] = DEFAULT_PLACE_REGION_IDS,
) -> list[dict]:
    """Select a deterministic, contrasting set of cases from candidates."""

    if max_cases < 1:
        raise ValueError("max_cases must be at least 1")
    if target_cases > max_cases:
        target_cases = max_cases

    ordered = sorted(candidates, key=_rank_key)
    selected: list[dict] = []
    used: set[tuple] = set()

    def add(candidate: Mapping, role: str) -> bool:
        if len(selected) >= max_cases:
            return False
        key = _candidate_key(candidate)
        if key in used:
            return False
        chosen = dict(candidate)
        chosen["role"] = role
        selected.append(chosen)
        used.add(key)
        return True

    # (b) strongest same-variable opposite-direction pair.
    groups: dict[tuple[str, str], dict[int, Mapping]] = {}
    for candidate in ordered:
        if candidate.get("kind") != "global":
            continue
        key = (str(candidate["variable"]), str(candidate["window"]))
        direction = int(candidate["trend_class"])
        current = groups.setdefault(key, {}).get(direction)
        if current is None or float(candidate["score"]) > float(current["score"]):
            groups[key][direction] = candidate

    pairs = []
    for (variable, window), directions in groups.items():
        if (
            contract.TREND_INCREASE in directions
            and contract.TREND_DECREASE in directions
        ):
            strength = min(
                float(directions[contract.TREND_INCREASE]["score"]),
                float(directions[contract.TREND_DECREASE]["score"]),
            )
            pairs.append((strength, variable, window, directions))
    pairs.sort(
        key=lambda item: (
            -item[0],
            0 if item[1] == precipitation_variable else 1,
            item[1],
            item[2],
        )
    )
    if pairs:
        _, _, _, directions = pairs[0]
        add(directions[contract.TREND_INCREASE], "opposite-pair-increasing")
        add(directions[contract.TREND_DECREASE], "opposite-pair-decreasing")

    # (a) an IMERG precipitation case.
    has_precipitation = any(
        candidate.get("variable") == precipitation_variable
        for candidate in selected
    )
    if not has_precipitation:
        precipitation = [
            candidate
            for candidate in ordered
            if candidate.get("variable") == precipitation_variable
        ]
        if precipitation:
            add(precipitation[0], "precipitation")

    # (c) a multi-variable pattern case, warming + drying preferred.
    patterns = [
        candidate for candidate in ordered if candidate.get("kind") == "pattern"
    ]
    patterns.sort(
        key=lambda candidate: (
            0 if candidate.get("pattern_code") == contract.PATTERN_WARMING_DRYING else 1,
            ) + _rank_key(candidate)
    )
    if patterns:
        add(patterns[0], "multi-variable-pattern")

    # (d) Southeast Asia / Mekong, only if the evidence supports it.
    place_boxes = [
        box
        for box in (
            _region_box(regions, region_id) for region_id in place_region_ids
        )
        if box is not None
    ]

    def _place_rank(candidate: Mapping, min_fraction: float = 0.5) -> tuple | None:
        center_lat, center_lon = candidate["center"]
        best: tuple | None = None
        for index, box in enumerate(place_boxes):
            fraction = _bbox_overlap_fraction(candidate["bbox"], box)
            center_inside = _point_in_bbox(
                float(center_lat), float(center_lon), box
            )
            if fraction < min_fraction:
                if min_fraction > 0.0 or not center_inside:
                    continue
            key = (index, -(fraction * float(candidate.get("score", 0.0))))
            if best is None or key < best:
                best = key
        return best

    if place_boxes and not any(
        _place_rank(candidate) is not None for candidate in selected
    ):
        place_candidates = [
            candidate
            for candidate in ordered
            if _candidate_key(candidate) not in used
            and _place_rank(candidate) is not None
        ]
        if not place_candidates:
            place_candidates = [
                candidate
                for candidate in ordered
                if _candidate_key(candidate) not in used
                and _place_rank(candidate, min_fraction=0.0) is not None
            ]
        place_candidates.sort(
            key=lambda candidate: (
                _place_rank(candidate, min_fraction=0.0),
                _rank_key(candidate),
            )
        )
        if place_candidates:
            add(place_candidates[0], "southeast-asia")

    # Fill with the best remaining distinct variable/window candidates.
    selected_pairs = {
        (candidate.get("variable"), candidate.get("window"))
        for candidate in selected
    }
    for candidate in ordered:
        if len(selected) >= target_cases:
            break
        if _candidate_key(candidate) in used:
            continue
        pair = (candidate.get("variable"), candidate.get("window"))
        if pair in selected_pairs:
            continue
        if add(candidate, "supporting"):
            selected_pairs.add(pair)

    for candidate in ordered:
        if len(selected) >= target_cases:
            break
        add(candidate, "supporting")

    return selected


def _variable_meta(registry: Mapping | Sequence, variable_id: str) -> Mapping:
    if isinstance(registry, Mapping):
        variables = registry.get("variables", [])
        products = registry.get("products", {}) or {}
    else:
        variables = registry
        products = {}
    for variable in variables:
        if variable.get("id") == variable_id:
            meta = dict(variable)
            product = meta.get("product")
            product_meta = products.get(product, {}) if product else {}
            if product_meta:
                meta.setdefault("doi", product_meta.get("doi", ""))
                meta.setdefault("product_version", product_meta.get("version", ""))
            return meta
    return {}


def _direction_word(trend_class: int) -> str:
    return "increasing" if trend_class == contract.TREND_INCREASE else "decreasing"


def _slope_unit(variable_meta: Mapping) -> str:
    """Evidence slope unit: the registry unit converted from per-year to per-decade."""

    unit = variable_meta.get("slope_unit")
    if not unit:
        display_unit = variable_meta.get("display_unit")
        unit = f"{display_unit} per year" if display_unit else ""
    unit = str(unit).strip()
    if unit == "per year":
        return "per decade"
    if unit.endswith(" per year"):
        return f"{unit[: -len(' per year')]} per decade"
    if unit.endswith("per year"):
        return f"{unit[: -len('per year')]}per decade"
    return f"{unit} per decade" if unit else "per decade"


def _evidence_json(stats: Mapping, variable_meta: Mapping) -> dict:
    valid = stats.get("valid_observations")
    return {
        "variable": stats["variable"],
        "product": str(variable_meta.get("product", "")),
        "doi": str(variable_meta.get("doi", "")),
        "method": EVIDENCE_METHOD,
        "sen_slope_decade": _round(stats.get("sen_slope_decade")),
        "slope_unit": _slope_unit(variable_meta),
        "p_value": _round(stats.get("p_value"), 8),
        "q_value": _round(stats.get("q_value"), 8),
        "valid_observations": int(round(float(valid))) if valid is not None else 0,
        "coverage_fraction": _round(stats.get("coverage_fraction")),
        "trend_class": int(stats.get("trend_class", 0)),
        # P06 spec: evidence also reports the quality-flag share.  It is an
        # additive field; consumers that only know contract section 9 ignore it.
        "quality_flag_fraction": _round(stats.get("quality_flag_fraction")),
    }


def _title(candidate: Mapping, variables: Mapping[str, Mapping]) -> str:
    label = candidate.get("label", "the selected region")
    if candidate.get("kind") == "pattern":
        wording = _PATTERN_WORDING.get(
            int(candidate.get("pattern_code", 0)), "a combined trend pattern"
        )
        return f"{label}: {wording}"
    variable_id = candidate["variable"]
    variable_label = str(
        variables.get(variable_id, {}).get("label", variable_id.replace("_", " "))
    )
    direction = _direction_word(int(candidate["trend_class"]))
    if variable_id == DEFAULT_PRECIPITATION_VARIABLE:
        return f"{label}: satellite rainfall is {direction}"
    return f"{label}: {variable_label.lower()} is {direction}"


def _why_selected(candidate: Mapping, variables: Mapping[str, Mapping]) -> str:
    evidence = candidate["evidence"]
    role = candidate.get("role", "")
    area = float(candidate.get("area_weight", 0.0))
    cells = int(candidate.get("cells", 0))
    flagged = float(candidate.get("flagged_fraction", 0.0))
    significant_share = float(candidate.get("significant_share", 0.0))
    window = candidate["window"]

    if candidate.get("kind") == "pattern":
        temp_stats, moist_stats = evidence
        temp_label = variables.get(temp_stats["variable"], {}).get(
            "label", temp_stats["variable"]
        )
        moist_label = variables.get(moist_stats["variable"], {}).get(
            "label", moist_stats["variable"]
        )
        return (
            f"Selected as the strongest connected pattern-{int(candidate['pattern_code'])} "
            f"cluster ({_PATTERN_WORDING[int(candidate['pattern_code'])]}) for "
            f"{temp_label} and {moist_label} in {window}. "
            f"The cluster has {cells} eligible cells (cos-latitude area {area:.2f}); "
            f"median slopes are {_format_slope(temp_stats, variables)} and "
            f"{_format_slope(moist_stats, variables)}; median q = "
            f"{_format_number(temp_stats.get('q_value'))} and "
            f"{_format_number(moist_stats.get('q_value'))}. "
            f"{significant_share:.0%} of the evaluated cells in its bounding box are "
            f"significant; quality-flag share is {flagged:.0%}. "
            f"Score = area x min(|standardized change|) x (1 - flag share)."
        )

    stats = evidence[0]
    variable_id = candidate["variable"]
    variable_label = variables.get(variable_id, {}).get("label", variable_id)
    if candidate.get("kind") == "country":
        text = (
            f"Selected from the country domain for {candidate.get('label')}: "
            f"{cells} eligible cells of {variable_label} with a significant "
            f"{_direction_word(candidate['trend_class'])} trend in {window} "
            f"(cos-latitude area {area:.2f}). Median Sen slope "
            f"{_format_slope(stats, variables)}; median q = "
            f"{_format_number(stats.get('q_value'))}; "
            f"{significant_share:.0%} of the evaluated cells in the country's "
            f"bounding box are significant; quality-flag share is {flagged:.0%}. "
            f"The country domain aggregates every majority-direction significant "
            "cell inside the country polygon, not only one connected cluster. "
            f"Score = area x |standardized change| x (1 - flag share) x "
            f"significant share = {float(candidate.get('score', 0.0)):.3f}."
        )
    else:
        text = (
            f"Selected by the deterministic cluster algorithm: {cells} eligible cells "
            f"of {variable_label} with a significant {_direction_word(candidate['trend_class'])} "
            f"trend in {window} form a connected cluster (cos-latitude area {area:.2f}). "
            f"Median Sen slope {_format_slope(stats, variables)}; median q = "
            f"{_format_number(stats.get('q_value'))}; {significant_share:.0%} of the "
            f"evaluated cells in its bounding box are significant; quality-flag share "
            f"is {flagged:.0%}. Score = area x |standardized change| x (1 - flag share) "
            f"= {float(candidate.get('score', 0.0)):.3f}."
        )
    if role in {"opposite-pair-increasing", "opposite-pair-decreasing"}:
        text += (
            " It is one half of the strongest same-variable opposite-direction "
            f"pair for {variable_label}: the same variable has significant "
            "clusters of both signs in this window."
        )
    elif role == "precipitation":
        text += (
            " It uses IMERG precipitation, a merged satellite mission product "
            "that is independent of the GLDAS forcing change, so it is the "
            "lead observational case."
        )
    elif role == "multi-variable-pattern":
        text += " It combines the two core variables through the pattern classes."
    elif role == "southeast-asia":
        text += (
            " It is the strongest supported candidate whose bounding box "
            "intersects the requested Southeast Asia / Mekong region."
        )
    return text


def _format_slope(stats: Mapping, variables: Mapping[str, Mapping]) -> str:
    value = stats.get("sen_slope_decade")
    variable_id = stats["variable"]
    unit = _slope_unit(variables.get(variable_id, {}))
    if value is None:
        return "undefined"
    return f"{float(value):+.4g} {unit}".strip()


def _format_number(value: float | None) -> str:
    if value is None:
        return "undefined"
    return f"{float(value):.3g}"


def _limitations(candidate: Mapping, variables: Mapping[str, Mapping]) -> list[str]:
    caveats: list[str] = []
    for stats in candidate["evidence"]:
        for caveat in variables.get(stats["variable"], {}).get("caveats", []) or []:
            text = str(caveat)
            if text not in caveats:
                caveats.append(text)

    if candidate.get("kind") == "country":
        caveats.append(
            "A country domain follows a political boundary, not a climate region; "
            "the numbers aggregate cells inside that boundary."
        )
    else:
        caveats.append(
            "A cluster is a descriptive grouping of cells with the same significant "
            "trend class, not a formal region boundary."
        )
    caveats.append(
        "Association is not causation: the case describes co-located trends and "
        "does not identify a causal mechanism."
    )
    if not candidate.get("quality_available", False):
        caveats.append(
            "No data-quality (step-change) layer was available for this run, so "
            "the case could not be screened for possible discontinuities."
        )
    else:
        flagged = float(candidate.get("flagged_fraction", 0.0))
        if flagged > 0.0:
            caveats.append(
                f"{flagged:.0%} of the cells in the source component carry a "
                "possible data-discontinuity flag (quality_flag >= 1); flagged "
                "cells were excluded from the evidence."
            )
    return caveats


def _case_from_candidate(
    candidate: Mapping,
    index: int,
    registry: Mapping | Sequence,
    *,
    overrides: Mapping[str, Mapping] | None = None,
) -> dict:
    variables = {
        variable_id: _variable_meta(registry, variable_id)
        for variable_id in candidate["variables"]
    }
    evidence = [
        _evidence_json(stats, variables[stats["variable"]])
        for stats in candidate["evidence"]
    ]
    case = {
        "id": f"case-{index:02d}",
        "title": _title(candidate, variables),
        "region": {
            "bbox": [float(value) for value in candidate["bbox"]],
            "label": str(candidate["label"]),
        },
        "window": str(candidate["window"]),
        "why_selected": _why_selected(candidate, variables),
        "evidence": evidence,
        "limitations": _limitations(candidate, variables),
    }
    override = (overrides or {}).get(case["id"], {})
    if isinstance(override, Mapping):
        if isinstance(override.get("title"), str) and override["title"].strip():
            case["title"] = override["title"].strip()
        if isinstance(override.get("why_selected"), str) and override[
            "why_selected"
        ].strip():
            case["why_selected"] = override["why_selected"].strip()
    return case


def build_cases_file(
    selected: Sequence[Mapping],
    registry: Mapping | Sequence,
    *,
    config: Mapping | None = None,
) -> dict:
    """Format selected candidates as the contract section 9 JSON object."""

    config = config or {}
    overrides = config.get("overrides", {}) or {}
    selection_method = str(
        config.get("selection_method") or DEFAULT_SELECTION_METHOD
    )
    cases = [
        _case_from_candidate(candidate, index, registry, overrides=overrides)
        for index, candidate in enumerate(selected, start=1)
    ]
    return {
        "synthetic": False,
        "selection_method": selection_method,
        "cases": cases,
    }


def dumps_cases(cases_file: Mapping) -> str:
    """Deterministic JSON text for ``cases.json``."""

    return json.dumps(cases_file, separators=(",", ":"), allow_nan=False)


def write_cases(cases_file: Mapping, path: str | Path) -> Path:
    """Write ``cases.json`` exactly as the export does (compact, no NaN)."""

    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(dumps_cases(cases_file), encoding="utf-8")
    return output


def load_cases_config(path: str | Path | None = None) -> dict:
    """Load ``config/cases.yaml``; missing file means defaults."""

    import yaml

    config_path = Path(path or DEFAULT_CASES_CONFIG_PATH)
    if not config_path.is_file():
        return {}
    data = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{config_path}: expected a YAML mapping")
    return data


__all__ = [
    "DEFAULT_CASES_CONFIG_PATH",
    "DEFAULT_EXPORT_DIR",
    "DEFAULT_MAX_CASES",
    "DEFAULT_MIN_CLUSTER_CELLS",
    "DEFAULT_SELECTION_METHOD",
    "DEFAULT_TARGET_CASES",
    "DEFAULT_TRENDS_DIR",
    "build_cases_file",
    "cluster_components",
    "country_candidates",
    "dumps_cases",
    "latitude_weights",
    "load_cases_config",
    "pattern_candidates",
    "place_label",
    "select_cases",
    "trend_candidates",
    "write_cases",
]
