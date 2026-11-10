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
6. When a witness agreement grid is supplied (or can be computed from a
   witness trend grid), each evidence item gains a ``witness`` object
   (contract section 13).  Finding scores are multiplied by
   ``0.5 + 0.5 × corroborated share``.  A finding whose cells are mostly
   contradicted (code −2 share above 50%) is not selected.

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
DEFAULT_PREFERRED_COUNTRY_IDS = ("country_704",)  # Vietnam (Natural Earth ISO 704)
DEFAULT_WINDOW_PRIORITY_BONUS = 1.25  # prefer 2001-2024 when raw scores are within 20%
DEFAULT_SPECIFIC_HUMIDITY_WEIGHT = 0.5  # documented early-period drop (REAL_RUN_REVIEW)
DEFAULT_PAIR_MAX_CONTRADICTED_SHARE = 0.20  # P06f witness pair requirement
EARLY_WINDOW_QUALITY_LIMITATION = (
    "12-year windows have little power to detect sudden shifts; the "
    "2001\u20132024 check was used instead"
)

EVIDENCE_METHOD = (
    "Sen's slope + Hamed-Rao modified Mann-Kendall + BH-FDR"
)

DEFAULT_SELECTION_METHOD = (
    "Deterministic selection from computed P03 grids (no hand-picked values). "
    "For each variable x window, cells with the same significant trend class "
    "(+1 or -1, BH-FDR q < q_threshold) are grouped into 8-neighbour connected "
    "clusters; clusters with fewer than the documented minimum of eligible "
    "cells are dropped and cells with quality_flag >= 1 (schema 1.2, when the "
    "layer exists) are excluded. For 12-year windows the union of the window's "
    "own quality flag and the 2001\u20132024 quality flag of the same variable is "
    "used, because 12 annual values have little power to detect a sudden shift. "
    "Candidates are scored as area (sum of cos(latitude) weights) x median "
    "|standardized change per decade| x (1 - quality-flag share). Candidates "
    "in the full 2001\u20132024 window get a ranking bonus of x1.25, so a "
    "full-window candidate is preferred whenever its raw score is within 20% "
    "of a shorter-window candidate. specific_humidity in 2001\u20132012 is "
    "down-weighted by x0.5 because REAL_RUN_REVIEW records a documented "
    "early-period drop in that GLDAS field, so that artefact-like segment "
    "should not win on score alone. The selected set covers, when the evidence "
    "supports it, (a) an IMERG precipitation case, (b) both directions of the "
    "strongest same-variable opposite-direction pair, (c) a multi-variable "
    "pattern case (warming + drying preferred), and (d) one Southeast Asia "
    "case preferring Vietnam, then the Mekong box, then the rest; remaining "
    "slots are filled with the highest-scoring distinct variable/window "
    "candidates. Country-level candidates are added when a schema 1.2 country "
    "grid is present. Two caution cases are emitted: the local Vietnam "
    "air-temperature case when that country domain has a significant warming "
    "trend (all country cells included, flagged share reported), and the global "
    "specific-humidity witness-disagreement case. Every evidence number is an "
    "area-weighted aggregate of "
    "the underlying cell grids. When a second-witness agreement layer is "
    "available, finding scores are multiplied by (0.5 + 0.5 x corroborated "
    "share) so corroborated clusters win ties, and a finding whose cells are "
    "mostly contradicted (agreement code -2 share above 50%) is never selected. "
    "P06f: the opposite pair is used only when both sides have witness majority "
    "code 2 and contradicted area below 20%, with preference for precipitation, "
    "then 2001\u20132024, then other variables; the two sides must have different "
    "place labels, otherwise the pair is skipped and the reason is printed. "
    "Two caution cases are emitted: the local Vietnam air-temperature case and "
    "one global specific-humidity witness-disagreement case."
)

# Slope-unit labels for the witness product after the conversions documented
# in spec P13.  GWETTOP / GWETROOT stay wetness fractions, not kg m-2.
_WITNESS_SLOPE_UNITS = {
    "air_temperature": "degC per decade",
    "surface_skin_temperature": "degC per decade",
    "specific_humidity": "g kg-1 per decade",
    "evapotranspiration": "mm/month per decade",
    "surface_soil_moisture": "fraction per decade",
    "root_zone_soil_moisture": "fraction per decade",
    "precipitation": "mm/month per decade",
}
_MERRA_WITNESS_LIMITATION = (
    "MERRA-2 is also a model (reanalysis); a witness is corroboration, "
    "not ground truth."
)
_GPCP_WITNESS_LIMITATION = (
    "GPCP shares rain-gauge inputs with IMERG; a witness is corroboration, "
    "not ground truth."
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

# A small UN M49 macro-region table keyed by ISO numeric code.  Africa and the
# Americas use the intermediate region where one exists (Southern Africa,
# Middle Africa, South America, ...), Asia/Europe/Oceania use the sub-region
# (Eastern Asia, South-eastern Asia, Northern Europe, ...).  Values are strings
# so they match the zero-padded ``iso_numeric`` field in regions.json.
_M49_SUBREGIONS: dict[str, frozenset[str]] = {
    "Australia and New Zealand": frozenset({"036", "162", "166", "334", "554", "574"}),
    "Caribbean": frozenset({"028", "044", "052", "092", "136", "192", "212", "214", "308", "312", "332", "388", "474", "500", "531", "533", "534", "535", "630", "652", "659", "660", "662", "663", "670", "780", "796", "850"}),
    "Central America": frozenset({"084", "188", "222", "320", "340", "484", "558", "591"}),
    "Central Asia": frozenset({"398", "417", "762", "795", "860"}),
    "Eastern Africa": frozenset({"086", "108", "174", "175", "231", "232", "260", "262", "404", "450", "454", "480", "508", "638", "646", "690", "706", "716", "728", "800", "834", "894"}),
    "Eastern Asia": frozenset({"156", "344", "392", "408", "410", "446", "496"}),
    "Eastern Europe": frozenset({"100", "112", "203", "348", "498", "616", "642", "643", "703", "804"}),
    "Melanesia": frozenset({"090", "242", "540", "548", "598"}),
    "Micronesia": frozenset({"296", "316", "520", "580", "581", "583", "584", "585"}),
    "Middle Africa": frozenset({"024", "120", "140", "148", "178", "180", "226", "266", "678"}),
    "Northern Africa": frozenset({"012", "434", "504", "729", "732", "788", "818"}),
    "Northern America": frozenset({"060", "124", "304", "666", "840"}),
    "Northern Europe": frozenset({"208", "233", "234", "246", "248", "352", "372", "428", "440", "578", "744", "752", "826", "831", "832", "833"}),
    "Polynesia": frozenset({"016", "184", "258", "570", "612", "772", "776", "798", "876", "882"}),
    "South America": frozenset({"032", "068", "074", "076", "152", "170", "218", "238", "239", "254", "328", "600", "604", "740", "858", "862"}),
    "South-eastern Asia": frozenset({"096", "104", "116", "360", "418", "458", "608", "626", "702", "704", "764"}),
    "Southern Africa": frozenset({"072", "426", "516", "710", "748"}),
    "Southern Asia": frozenset({"004", "050", "064", "144", "356", "364", "462", "524", "586"}),
    "Southern Europe": frozenset({"008", "020", "070", "191", "292", "300", "336", "380", "470", "499", "620", "674", "688", "705", "724", "807"}),
    "Western Africa": frozenset({"132", "204", "270", "288", "324", "384", "430", "466", "478", "562", "566", "624", "654", "686", "694", "768", "854"}),
    "Western Asia": frozenset({"031", "048", "051", "196", "268", "275", "368", "376", "400", "414", "422", "512", "634", "682", "760", "784", "792", "887"}),
    "Western Europe": frozenset({"040", "056", "250", "276", "438", "442", "492", "528", "756"}),
}

_M49_SUBREGION_BY_ISO: dict[str, str] = {
    iso: macro for macro, codes in _M49_SUBREGIONS.items() for iso in codes
}


def dominant_country_label(
    candidate: Mapping,
    countries: Sequence[Mapping] = (),
    country_grid: np.ndarray | None = None,
) -> str | None:
    """Country name holding most of the candidate's cells (or top two).

    Country-domain candidates use their own label.  For global clusters the
    schema 1.2 country grid is used; the top country wins, or the top two are
    joined with "and" when they jointly hold most cells.  Returns ``None``
    when no country covers any candidate cell (caller falls back to the
    existing place label).
    """

    if candidate.get("kind") in {"country", "caution"} and candidate.get("label"):
        return str(candidate["label"])
    if country_grid is None or not countries:
        return None
    rows = candidate.get("rows")
    cols = candidate.get("cols")
    if rows is None or cols is None:
        return None
    grid = _require_contract_shape("country_grid", country_grid)
    values = np.asarray(grid)[np.asarray(rows, dtype=int), np.asarray(cols, dtype=int)]
    values = values[values != contract.COUNTRY_NONE]
    if values.size == 0:
        return None

    labels = {
        int(country["index"]): str(country.get("label") or country.get("id"))
        for country in countries
        if "index" in country
    }
    iso_by_index = {}
    for country in countries:
        if "index" not in country:
            continue
        iso = str(country.get("iso_numeric") or "").strip()
        if iso.isdigit():
            iso = iso.zfill(3)
        iso_by_index[int(country["index"])] = iso
    counts = {}
    for value in values.tolist():
        counts[int(value)] = counts.get(int(value), 0) + 1
    ranked = sorted(
        counts.items(),
        key=lambda item: (-item[1], labels.get(item[0], str(item[0]))),
    )
    total = sum(counts.values())
    if total <= 0:
        return None
    top_index, top_count = ranked[0]
    top_label = labels.get(top_index, str(top_index))
    top_share = top_count / total
    if len(ranked) == 1:
        return top_label
    second_index, second_count = ranked[1]
    combined_share = (top_count + second_count) / total
    if top_share >= 0.5 and combined_share < 0.7:
        return top_label
    if combined_share >= 0.7:
        second_label = labels.get(second_index, str(second_index))
        return f"{top_label} and {second_label}"

    macro_counts: dict[str, int] = {}
    for index, count in counts.items():
        macro = _M49_SUBREGION_BY_ISO.get(iso_by_index.get(index, ""))
        if macro:
            macro_counts[macro] = macro_counts.get(macro, 0) + count
    if macro_counts:
        macro_total = sum(macro_counts.values())
        ranked_macro = sorted(macro_counts.items(), key=lambda item: (-item[1], item[0]))
        top_macro, top_macro_count = ranked_macro[0]
        if len(ranked_macro) == 1 or top_macro_count / macro_total >= 0.5:
            return top_macro
        second_macro, second_macro_count = ranked_macro[1]
        if (top_macro_count + second_macro_count) / macro_total >= 0.7:
            return f"{top_macro} and {second_macro}"
        return top_macro
    return None


def _place_name(
    candidate: Mapping,
    countries: Sequence[Mapping],
    country_grid: np.ndarray | None,
) -> str:
    label = dominant_country_label(candidate, countries, country_grid)
    if label:
        return label
    return str(candidate.get("label") or "the selected region")


def _as_place_phrase(place: str) -> str:
    return f"near {place}" if "\N{DEGREE SIGN}" in place else f"over {place}"


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


def combine_quality_flags(
    primary: np.ndarray | None,
    extra: np.ndarray | None,
) -> np.ndarray | None:
    """Union of two quality-flag grids, keeping the stronger code.

    ``-99``/``-9`` from the primary grid are preserved unless either grid
    marks the cell as a step (``>= 1``). Code 2 wins over code 1.
    """

    if primary is None:
        return None if extra is None else np.asarray(extra, dtype=np.int8).copy()
    if extra is None:
        return np.asarray(primary, dtype=np.int8).copy()
    first = np.asarray(primary, dtype=np.int8)
    second = np.asarray(extra, dtype=np.int8)
    if first.shape != second.shape:
        raise ValueError(
            f"quality grids must have the same shape, got {first.shape} and {second.shape}"
        )
    result = first.copy()
    both_flagged = (first >= 1) | (second >= 1)
    result[both_flagged & (result < 1)] = 1
    known_forcing = (
        (first == contract.QUALITY_STEP_KNOWN_FORCING)
        | (second == contract.QUALITY_STEP_KNOWN_FORCING)
    )
    result[known_forcing] = contract.QUALITY_STEP_KNOWN_FORCING
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


def witness_metadata(variable_id: str) -> dict:
    """Product, source variable, slope unit and limitation for one witness.

    Names and versions come from ``contract.WITNESSES``.  The human label
    matches contract section 13 ("MERRA-2 reanalysis" / "GPCP satellite\u2013gauge").
    """

    spec = contract.WITNESSES.get(variable_id)
    if spec is None:
        return {
            "product": variable_id,
            "variable": variable_id,
            "label": "an independent NASA dataset",
            "slope_unit": "per decade",
            "limitation": (
                "A witness is corroboration, not ground truth."
            ),
        }
    short_name, version, source_variable = spec
    if str(short_name).startswith("M2"):
        family = "MERRA-2"
        label = "MERRA-2 reanalysis"
        limitation = _MERRA_WITNESS_LIMITATION
    else:
        family = "GPCP"
        label = "GPCP satellite\u2013gauge"
        limitation = _GPCP_WITNESS_LIMITATION
    return {
        "product": f"{family} {short_name} {version}",
        "variable": str(source_variable),
        "label": label,
        "slope_unit": _WITNESS_SLOPE_UNITS.get(variable_id, "per decade"),
        "limitation": limitation,
    }


def witness_agreement_grid(
    main: Mapping[str, np.ndarray],
    witness: Mapping[str, np.ndarray],
    mask: np.ndarray | None = None,
) -> np.ndarray:
    """Contract section 13 agreement codes from main and witness trend grids.

    Sign comes from each product's Sen slope.  Significance is that product's
    own BH-FDR ``q < Q_THRESHOLD``.  Codes are 2 / 1 / -1 / -2 / 0 / -9 / -99.
    """

    main_class = _require_contract_shape("trend_class", main["trend_class"])
    witness_class = _require_contract_shape(
        "witness trend_class", witness["trend_class"]
    )
    main_slope = np.asarray(main["sen_slope_decade"], dtype=float)
    witness_slope = np.asarray(witness["sen_slope_decade"], dtype=float)
    main_q = np.asarray(main["q_value"], dtype=float)
    witness_q = np.asarray(witness["q_value"], dtype=float)
    if main_slope.shape != main_class.shape or witness_slope.shape != main_class.shape:
        raise ValueError("witness trend grids must match the contract grid shape")
    if main_q.shape != main_class.shape or witness_q.shape != main_class.shape:
        raise ValueError("witness q grids must match the contract grid shape")

    if mask is None:
        inside = np.ones(main_class.shape, dtype=bool)
    else:
        inside = _require_contract_shape("mask", mask).astype(bool, copy=False)

    result = np.full(main_class.shape, contract.INSUFFICIENT_DATA, dtype=np.int8)
    outside = (
        ~inside
        | (main_class == contract.OUTSIDE_DOMAIN)
        | (witness_class == contract.OUTSIDE_DOMAIN)
    )
    result[outside] = contract.OUTSIDE_DOMAIN

    not_evaluated = ~outside & (
        (main_class == contract.INSUFFICIENT_DATA)
        | (witness_class == contract.INSUFFICIENT_DATA)
        | ~np.isfinite(main_slope)
        | ~np.isfinite(witness_slope)
        | ~np.isfinite(main_q)
        | ~np.isfinite(witness_q)
    )
    result[not_evaluated] = contract.INSUFFICIENT_DATA

    usable = ~outside & ~not_evaluated
    main_sign = np.sign(main_slope)
    witness_sign = np.sign(witness_slope)
    main_significant = usable & (main_q < contract.Q_THRESHOLD) & (main_sign != 0)
    witness_significant = (
        usable & (witness_q < contract.Q_THRESHOLD) & (witness_sign != 0)
    )
    same_sign = usable & (main_sign == witness_sign) & (main_sign != 0)

    result[usable & ~main_significant] = contract.WITNESS_MAIN_NOT_SIGNIFICANT
    result[main_significant & same_sign & witness_significant] = (
        contract.WITNESS_CORROBORATED
    )
    result[main_significant & same_sign & ~witness_significant] = (
        contract.WITNESS_SAME_SIGN
    )
    result[main_significant & ~same_sign & ~witness_significant] = (
        contract.WITNESS_OPPOSITE_SIGN
    )
    result[main_significant & ~same_sign & witness_significant] = (
        contract.WITNESS_CONTRADICTED
    )
    return result


def _majority_agreement_code(codes: np.ndarray, weights: np.ndarray) -> int:
    """Area-weighted mode.  Equal weights break toward the lower code."""

    totals: dict[int, float] = {}
    for code, weight in zip(codes.tolist(), weights.tolist()):
        key = int(code)
        totals[key] = totals.get(key, 0.0) + float(weight)
    return min(totals.items(), key=lambda item: (-item[1], item[0]))[0]


def _resolve_witness_agreement(
    main_layers: Mapping[str, np.ndarray],
    witness_layers: Mapping[str, np.ndarray],
) -> np.ndarray:
    """Use a supplied agreement grid, or compute one from witness trends."""

    agreement = witness_layers.get("agreement")
    if agreement is not None:
        return _require_contract_shape("witness_agreement", agreement).astype(
            np.int8, copy=False
        )
    required = ("trend_class", "sen_slope_decade", "q_value")
    missing = [name for name in required if name not in witness_layers]
    if missing:
        raise KeyError(
            "witness layers need 'agreement' or trend fields "
            f"({', '.join(missing)} missing)"
        )
    return witness_agreement_grid(main_layers, witness_layers)


def _aggregate_witness(
    main_layers: Mapping[str, np.ndarray],
    witness_layers: Mapping[str, np.ndarray],
    cells: np.ndarray,
    weights: np.ndarray,
    variable_id: str,
) -> dict:
    """Median witness slope, median q and majority agreement over ``cells``."""

    agreement = _resolve_witness_agreement(main_layers, witness_layers)
    rows, cols = np.nonzero(cells)
    cell_weights = weights[rows]
    codes = np.asarray(agreement)[rows, cols]
    evaluated = (codes != contract.OUTSIDE_DOMAIN) & (
        codes != contract.INSUFFICIENT_DATA
    )
    meta = witness_metadata(variable_id)
    slope_grid = witness_layers.get("sen_slope_decade")
    q_grid = witness_layers.get("q_value")
    if slope_grid is None:
        slope_values = np.full(rows.shape, np.nan)
    else:
        slope_values = np.asarray(slope_grid, dtype=float)[rows, cols]
    if q_grid is None:
        q_values = np.full(rows.shape, np.nan)
    else:
        q_values = np.asarray(q_grid, dtype=float)[rows, cols]

    if not np.any(evaluated):
        return {
            **meta,
            "sen_slope_decade": weighted_median(slope_values, cell_weights),
            "q_value": weighted_median(q_values, cell_weights),
            "agreement": int(contract.INSUFFICIENT_DATA),
            "corroborated_share": None,
            "contradicted_share": None,
        }

    eval_weights = cell_weights[evaluated]
    eval_codes = codes[evaluated]
    total = float(eval_weights.sum())
    corroborated = float(
        eval_weights[eval_codes == contract.WITNESS_CORROBORATED].sum() / total
    )
    contradicted = float(
        eval_weights[eval_codes == contract.WITNESS_CONTRADICTED].sum() / total
    )
    return {
        **meta,
        "sen_slope_decade": weighted_median(slope_values, cell_weights),
        "q_value": weighted_median(q_values, cell_weights),
        "agreement": _majority_agreement_code(eval_codes, eval_weights),
        "corroborated_share": corroborated,
        "contradicted_share": contradicted,
    }


def _apply_witness(
    *,
    kind: str,
    evidence: list[dict],
    score: float,
    layers_by_variable: Mapping[str, Mapping[str, np.ndarray]],
    witness_by_variable: Mapping[str, Mapping[str, np.ndarray]] | None,
    eligible: np.ndarray,
    weights: np.ndarray,
) -> tuple[float, float | None, float | None, float]:
    """Attach witness aggregates and scale a finding score.

    Returns ``(score, corroborated_share, contradicted_share, factor)``.
    Corroborated share is the lowest across the case's variables; contradicted
    share is the highest, so one contradicted variable can reject the finding.
    """

    if not witness_by_variable:
        return score, None, None, 1.0

    corroborated_shares: list[float] = []
    contradicted_shares: list[float] = []
    for stats in evidence:
        variable_id = stats["variable"]
        witness_layers = witness_by_variable.get(variable_id)
        if not witness_layers:
            continue
        record = _aggregate_witness(
            layers_by_variable[variable_id],
            witness_layers,
            eligible,
            weights,
            variable_id,
        )
        stats["witness"] = record
        if record["corroborated_share"] is not None:
            corroborated_shares.append(float(record["corroborated_share"]))
        if record["contradicted_share"] is not None:
            contradicted_shares.append(float(record["contradicted_share"]))

    corroborated = min(corroborated_shares) if corroborated_shares else None
    contradicted = max(contradicted_shares) if contradicted_shares else None
    factor = 1.0
    if kind != "caution" and corroborated is not None:
        factor = 0.5 + 0.5 * corroborated
        score *= factor
    return score, corroborated, contradicted, factor


def _finding_mostly_contradicted(candidate: Mapping) -> bool:
    """True when a finding's cells are mostly agreement code -2."""

    if candidate.get("kind") == "caution":
        return False
    share = candidate.get("witness_contradicted_share")
    if share is None:
        return False
    # Area weights can land an ulp above an exact half.  One extra cell on the
    # contract grid is about 1e-5, so 1e-9 still means "more than 50%".
    value = float(share)
    return value > 0.5 and not math.isclose(value, 0.5, rel_tol=0.0, abs_tol=1e-9)


def _pair_witness_check(
    candidate: Mapping, max_contradicted_share: float
) -> tuple[bool, str]:
    """P06f: both pair sides need witness majority code 2 and low contradiction."""

    evidence = candidate.get("evidence") or []
    if not evidence:
        return False, "no evidence"
    witness = evidence[0].get("witness")
    if not witness:
        return False, "no witness agreement layer"
    agreement = int(witness.get("agreement", contract.INSUFFICIENT_DATA))
    if agreement != contract.WITNESS_CORROBORATED:
        return False, f"witness majority code {agreement}, not 2"
    share = candidate.get("witness_contradicted_share")
    if share is None:
        return False, "witness contradiction share unavailable"
    if float(share) >= max_contradicted_share:
        return False, (
            f"witness contradicted share {float(share):.0%} is not below "
            f"{max_contradicted_share:.0%}"
        )
    return True, ""


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
    quality_check_windows: Sequence[str] = (),
    pattern_code: int | None = None,
    country: Mapping | None = None,
    evidence_classes: Mapping[str, int] | None = None,
    witness_by_variable: Mapping[str, Mapping[str, np.ndarray]] | None = None,
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
    component_rows, _ = np.nonzero(component)
    flagged_rows, _ = np.nonzero(flagged)
    component_area = float(weights[component_rows].sum())
    quality_flag_share = (
        float(weights[flagged_rows].sum() / component_area)
        if component_area > 0.0
        else 0.0
    )

    evidence = []
    area_weight = float(weights[rows].sum())
    for variable_id in variables:
        stats = _layer_stats(
            layers_by_variable[variable_id],
            eligible,
            weights,
            (evidence_classes or {}).get(variable_id, trend_class),
            quality_flag_share,
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
    score = area_weight * score_base * (1.0 - quality_flag_share)

    score_adjustment = 1.0
    score_adjustment_reason = ""
    if variable == "specific_humidity" and window == "2001-2012":
        score_adjustment = DEFAULT_SPECIFIC_HUMIDITY_WEIGHT
        score *= score_adjustment
        score_adjustment_reason = (
            "specific_humidity in 2001\u20132012 is down-weighted by 0.5 because "
            "REAL_RUN_REVIEW documents an early-period drop in this GLDAS field."
        )

    score_before_witness = float(score)
    score, witness_corroborated_share, witness_contradicted_share, witness_factor = (
        _apply_witness(
            kind=kind,
            evidence=evidence,
            score=score,
            layers_by_variable=layers_by_variable,
            witness_by_variable=witness_by_variable,
            eligible=eligible,
            weights=weights,
        )
    )

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
        "quality_flag_share": quality_flag_share,
        "quality_available": quality_available,
        "quality_check_windows": list(quality_check_windows),
        "bbox": bbox,
        "center": center,
        "label": label,
        "score": float(score),
        "score_before_witness": score_before_witness,
        "score_adjustment": score_adjustment,
        "score_adjustment_reason": score_adjustment_reason,
        "witness_corroborated_share": witness_corroborated_share,
        "witness_contradicted_share": witness_contradicted_share,
        "witness_score_factor": float(witness_factor),
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
    quality_check_windows: Sequence[str] = (),
    min_cluster_cells: int = DEFAULT_MIN_CLUSTER_CELLS,
    regions: Sequence[Mapping] = (),
    witness_layers: Mapping[str, np.ndarray] | None = None,
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
                quality_check_windows=quality_check_windows,
                witness_by_variable=(
                    {variable: witness_layers} if witness_layers else None
                ),
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
    quality_check_windows: Sequence[str] = (),
    pattern_codes: Iterable[int] = (
        contract.PATTERN_WARMING_DRYING,
        contract.PATTERN_WARMING_WETTING,
        contract.PATTERN_COOLING_DRYING,
        contract.PATTERN_COOLING_WETTING,
    ),
    min_cluster_cells: int = DEFAULT_MIN_CLUSTER_CELLS,
    regions: Sequence[Mapping] = (),
    witness_by_variable: Mapping[str, Mapping[str, np.ndarray]] | None = None,
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
                quality_check_windows=quality_check_windows,
                pattern_code=pattern_code,
                evidence_classes={
                    temperature_variable: _dominant_class(
                        layers_by_variable[temperature_variable], eligible
                    ),
                    moisture_variable: _dominant_class(
                        layers_by_variable[moisture_variable], eligible
                    ),
                },
                witness_by_variable=witness_by_variable,
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
    quality_check_windows: Sequence[str] = (),
    min_cells: int = DEFAULT_MIN_CLUSTER_CELLS,
    regions: Sequence[Mapping] = (),
    witness_by_variable: Mapping[str, Mapping[str, np.ndarray]] | None = None,
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
                quality_check_windows=quality_check_windows,
                country=country,
                witness_by_variable=witness_by_variable,
            )
            if candidate is not None:
                candidate["score"] *= significant_share
                candidate["score_before_witness"] = (
                    float(candidate["score_before_witness"]) * significant_share
                )
                candidates.append(candidate)
    return candidates


def build_caution_candidate(
    layers: Mapping[str, np.ndarray],
    variable: str,
    window: str,
    country: Mapping,
    country_grid: np.ndarray,
    *,
    mask: np.ndarray | None = None,
    quality_flag: np.ndarray | None = None,
    breakpoint_year: np.ndarray | None = None,
    min_cells: int = DEFAULT_MIN_CLUSTER_CELLS,
    regions: Sequence[Mapping] = (),
    witness_layers: Mapping[str, np.ndarray] | None = None,
) -> tuple[dict | None, str]:
    """Build the single Vietnam-style caution case without flag exclusion.

    The case uses the whole country domain (all evaluated cells, flagged or
    not).  It is only built when the variable has a significant warming trend
    in the country: at least half of the evaluated cells are significant,
    more cells warm than cool, and the area-weighted median slope is positive.
    Returns ``(candidate, reason)``; ``candidate`` is ``None`` and ``reason``
    explains why when the caution case cannot be supported.
    """

    if quality_flag is None:
        return None, "no quality layer is available, so a flagged share cannot be reported"

    classes = _require_contract_shape("trend_class", layers["trend_class"])
    grid = _require_contract_shape("country_grid", country_grid)
    index = int(country.get("index", contract.COUNTRY_NONE))
    if index == contract.COUNTRY_NONE:
        return None, "country has no index in the country_grid"

    country_cells = grid == index
    if mask is None:
        allowed = country_cells
    else:
        allowed = country_cells & _require_contract_shape("mask", mask).astype(
            bool, copy=False
        )
    evaluated = allowed & np.isin(classes, _EVALUATED_CLASSES)
    evaluated_cells = int(evaluated.sum())
    if evaluated_cells < min_cells:
        return None, (
            f"only {evaluated_cells} evaluated cells in the country domain "
            f"(minimum {min_cells})"
        )

    increasing = allowed & (classes == contract.TREND_INCREASE)
    decreasing = allowed & (classes == contract.TREND_DECREASE)
    significant = increasing | decreasing
    significant_share = int(significant.sum()) / max(1, evaluated_cells)
    if significant_share < 0.5:
        return None, (
            f"only {significant_share:.0%} of the evaluated country cells have "
            "a significant trend"
        )
    if int(increasing.sum()) <= int(decreasing.sum()):
        return None, (
            "the significant cells do not have a warming majority "
            f"({int(increasing.sum())} increasing vs {int(decreasing.sum())} decreasing)"
        )

    weights = latitude_weights()
    rows, _ = np.nonzero(evaluated)
    median_slope = weighted_median(
        np.asarray(layers["sen_slope_decade"], dtype=float)[evaluated],
        weights[rows],
    )
    if median_slope is None or median_slope <= 0.0:
        return None, "the area-weighted median slope is not warming"

    quality = _require_contract_shape("quality_flag", quality_flag)
    flagged = evaluated & (quality >= 1)

    candidate = _make_candidate(
        kind="caution",
        variable=variable,
        variables=(variable,),
        window=window,
        trend_class=contract.TREND_INCREASE,
        component=allowed,
        eligible=evaluated,
        flagged=flagged,
        layers_by_variable={variable: layers},
        evaluated=evaluated,
        weights=weights,
        regions=regions,
        quality_available=True,
        quality_check_windows=(window,),
        country=country,
        witness_by_variable=(
            {variable: witness_layers} if witness_layers else None
        ),
    )
    if candidate is None:
        return None, "the country domain produced no usable evidence"

    break_year = None
    if breakpoint_year is not None:
        breaks = np.asarray(breakpoint_year, dtype=float)[flagged]
        breaks = breaks[np.isfinite(breaks)]
        if breaks.size:
            break_year = float(np.median(breaks))
    candidate["break_year"] = break_year
    candidate["significant_share"] = float(significant_share)
    candidate["caution_type"] = "vietnam_temperature"
    candidate["region_id"] = str(country.get("id") or "")
    candidate["caution_reason"] = (
        "Caution case: the country domain includes every evaluated cell, "
        "including cells with quality_flag >= 1."
    )
    return candidate, ""


# ---------------------------------------------------------------------------
# Selection and case formatting
# ---------------------------------------------------------------------------


def build_global_caution_candidate(
    layers: Mapping[str, np.ndarray],
    variable: str,
    window: str,
    mask: np.ndarray,
    *,
    quality_flag: np.ndarray | None = None,
    witness_layers: Mapping[str, np.ndarray] | None = None,
    regions: Sequence[Mapping] = (),
    min_cells: int = DEFAULT_MIN_CLUSTER_CELLS,
    screener_contradicted_fraction: float | None = None,
) -> tuple[dict | None, str]:
    """Build the global "the second witness disagrees" caution case.

    The case covers the significant decreasing area of one variable over the
    global common mask (specific humidity, 2001-2024). It reports the GLDAS
    decreasing area, the witness increasing area and the witness contradicted
    share; it is not a ranking finding.
    """

    classes = _require_contract_shape("trend_class", layers["trend_class"])
    domain = _require_contract_shape("mask", mask).astype(bool, copy=False)
    evaluated = domain & np.isin(classes, _EVALUATED_CLASSES)
    decreasing = domain & (classes == contract.TREND_DECREASE)
    if int(decreasing.sum()) < min_cells:
        return None, (
            f"only {int(decreasing.sum())} significant decreasing cells "
            f"(minimum {min_cells})"
        )
    if witness_layers is None or "trend_class" not in witness_layers:
        return None, "no witness trend class is available for the disagreement case"

    witness_class = _require_contract_shape(
        "witness trend_class", witness_layers["trend_class"]
    )
    witness_evaluated = domain & np.isin(witness_class, _EVALUATED_CLASSES)
    weights = latitude_weights()
    evaluated_rows, _ = np.nonzero(evaluated)
    decreasing_rows, _ = np.nonzero(decreasing)
    witness_rows, _ = np.nonzero(witness_evaluated)
    witness_increasing = domain & (witness_class == contract.TREND_INCREASE)
    witness_increasing_rows, _ = np.nonzero(witness_increasing)
    evaluated_area = float(weights[evaluated_rows].sum())
    witness_area = float(weights[witness_rows].sum())
    main_decreasing_share = (
        float(weights[decreasing_rows].sum() / evaluated_area)
        if evaluated_area > 0
        else None
    )
    witness_increasing_share = (
        float(weights[witness_increasing_rows].sum() / witness_area)
        if witness_area > 0
        else None
    )

    quality = (
        _require_contract_shape("quality_flag", quality_flag)
        if quality_flag is not None
        else None
    )
    flagged = (
        decreasing & (quality >= 1)
        if quality is not None
        else np.zeros_like(decreasing)
    )
    candidate = _make_candidate(
        kind="caution",
        variable=variable,
        variables=(variable,),
        window=window,
        trend_class=contract.TREND_DECREASE,
        component=decreasing,
        eligible=decreasing,
        flagged=flagged,
        layers_by_variable={variable: layers},
        evaluated=evaluated,
        weights=weights,
        regions=regions,
        quality_available=quality is not None,
        quality_check_windows=(window,),
        country={"label": "Global land"},
        witness_by_variable=(
            {variable: witness_layers} if witness_layers else None
        ),
    )
    if candidate is None:
        return None, "the global decreasing area produced no usable evidence"

    # The summary's contradicted share is over *all* significant main-trend
    # area (both directions), matching the P14 Screener definition.
    significant = domain & np.isin(classes, (-1, 1))
    significant_rows, significant_cols = np.nonzero(significant)
    agreement = _resolve_witness_agreement(layers, witness_layers)
    codes = np.asarray(agreement)[significant_rows, significant_cols]
    usable = (codes != contract.OUTSIDE_DOMAIN) & (
        codes != contract.INSUFFICIENT_DATA
    )
    if usable.any():
        cell_weights = weights[significant_rows][usable]
        global_contradicted = float(
            cell_weights[codes[usable] == contract.WITNESS_CONTRADICTED].sum()
            / cell_weights.sum()
        )
    else:
        global_contradicted = None
    candidate["caution_type"] = "witness_disagreement"
    candidate["main_decrease_fraction"] = main_decreasing_share
    candidate["witness_increase_fraction"] = witness_increasing_share
    candidate["witness_contradicted_share"] = (
        float(screener_contradicted_fraction)
        if screener_contradicted_fraction is not None
        else global_contradicted
    )
    candidate["screener_contradicted_fraction"] = (
        float(screener_contradicted_fraction)
        if screener_contradicted_fraction is not None
        else None
    )
    candidate["region_id"] = "global"
    candidate["bbox"] = [-180.0, -60.0, 180.0, 90.0]
    candidate["caution_reason"] = (
        "Global caution case: GLDAS shows a significant decreasing area while "
        "the independent witness largely increases."
    )
    return candidate, ""


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


def _preference_score(
    candidate: Mapping,
    window_priority_bonus: float = DEFAULT_WINDOW_PRIORITY_BONUS,
) -> float:
    """Score used only for ordering: boost the full 2001-2024 window.

    A x1.25 boost means a 2001-2024 candidate wins whenever its raw score is
    at least 80% of a shorter-window candidate's score (i.e. within 20%).
    """

    score = float(candidate.get("score", 0.0))
    if candidate.get("window") == "2001-2024":
        score *= window_priority_bonus
    return score


def _rank_key(
    candidate: Mapping,
    window_priority_bonus: float = DEFAULT_WINDOW_PRIORITY_BONUS,
) -> tuple:
    return (
        -_preference_score(candidate, window_priority_bonus),
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
    preferred_country_ids: Sequence[str] = DEFAULT_PREFERRED_COUNTRY_IDS,
    preferred_country_labels: Sequence[str] = ("vietnam",),
    min_place_cells: int = DEFAULT_MIN_CLUSTER_CELLS,
    window_priority_bonus: float = DEFAULT_WINDOW_PRIORITY_BONUS,
    max_pair_contradicted_share: float = DEFAULT_PAIR_MAX_CONTRADICTED_SHARE,
    countries: Sequence[Mapping] = (),
    country_grid: np.ndarray | None = None,
    selection_notes: list[str] | None = None,
) -> list[dict]:
    """Select a deterministic, contrasting set of cases from candidates."""

    if max_cases < 1:
        raise ValueError("max_cases must be at least 1")
    if target_cases > max_cases:
        target_cases = max_cases
    notes = selection_notes if selection_notes is not None else []

    def rank(candidate: Mapping) -> tuple:
        return _rank_key(candidate, window_priority_bonus)

    ordered = [
        candidate
        for candidate in sorted(candidates, key=rank)
        if not _finding_mostly_contradicted(candidate)
    ]
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
    # P06f: both sides must be corroborated by the witness (majority code 2,
    # contradicted area < 20%) and must not carry the same place label.
    groups: dict[tuple[str, str], dict[int, Mapping]] = {}
    for candidate in ordered:
        if candidate.get("kind") != "global":
            continue
        key = (str(candidate["variable"]), str(candidate["window"]))
        direction = int(candidate["trend_class"])
        current = groups.setdefault(key, {}).get(direction)
        if current is None or _preference_score(
            candidate, window_priority_bonus
        ) > _preference_score(current, window_priority_bonus):
            groups[key][direction] = candidate

    pairs = []
    for (variable, window), directions in groups.items():
        if (
            contract.TREND_INCREASE in directions
            and contract.TREND_DECREASE in directions
        ):
            strength = min(
                _preference_score(
                    directions[contract.TREND_INCREASE], window_priority_bonus
                ),
                _preference_score(
                    directions[contract.TREND_DECREASE], window_priority_bonus
                ),
            )
            pairs.append((strength, variable, window, directions))
    pairs.sort(
        key=lambda item: (
            0 if item[1] == precipitation_variable else 1,
            0 if item[2] == "2001-2024" else 1,
            -item[0],
            item[1],
            item[2],
        )
    )

    if not pairs:
        notes.append(
            "Opposite pair skipped: no same-variable pair with both "
            "significant directions exists."
        )
    else:
        pair_added = False
        rejection_notes: list[str] = []
        for _, variable, window, directions in pairs:
            increasing = directions[contract.TREND_INCREASE]
            decreasing = directions[contract.TREND_DECREASE]
            ok_inc, why_inc = _pair_witness_check(
                increasing, max_pair_contradicted_share
            )
            ok_dec, why_dec = _pair_witness_check(
                decreasing, max_pair_contradicted_share
            )
            if not (ok_inc and ok_dec):
                rejection_notes.append(
                    f"{variable}/{window}: increasing side "
                    f"{why_inc or 'ok'}; decreasing side {why_dec or 'ok'}"
                )
                continue
            inc_place = _place_name(increasing, countries, country_grid)
            dec_place = _place_name(decreasing, countries, country_grid)
            if inc_place == dec_place:
                rejection_notes.append(
                    f"{variable}/{window}: both sides are labelled "
                    f"{inc_place!r}"
                )
                continue
            if len(selected) + 2 > max_cases:
                rejection_notes.append(
                    f"{variable}/{window}: not enough case slots for both sides"
                )
                continue
            if add(increasing, "opposite-pair-increasing") and add(
                decreasing, "opposite-pair-decreasing"
            ):
                pair_added = True
                break
        if not pair_added:
            detail = "; ".join(rejection_notes[:4])
            notes.append(
                "Opposite pair skipped: no pair met both witness code-2 / "
                f"contradicted < {max_pair_contradicted_share:.0%} and "
                f"distinct-place rules"
                + (f" ({detail})" if detail else "")
                + "."
            )

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
            ) + rank(candidate)
    )
    if patterns:
        add(patterns[0], "multi-variable-pattern")

    # (d) one Southeast Asia slot: Vietnam, then Mekong, then the rest.
    # It is omitted when no candidate has enough eligible cells (>= 15).
    place_boxes = [
        box
        for box in (
            _region_box(regions, region_id) for region_id in place_region_ids
        )
        if box is not None
    ]
    mekong_box = _region_box(regions, "mekong")
    southeast_box = _region_box(regions, "southeast_asia")
    preferred_ids = {str(value) for value in preferred_country_ids}
    preferred_labels = {str(value).strip().lower() for value in preferred_country_labels}

    def _is_preferred_country(candidate: Mapping) -> bool:
        country_id = str(candidate.get("country_id") or "")
        label = str(candidate.get("label") or "").strip().lower()
        return country_id in preferred_ids or label in preferred_labels

    def _in_box(candidate: Mapping, box: Sequence[float] | None) -> bool:
        if box is None:
            return False
        center_lat, center_lon = candidate["center"]
        return bool(
            _point_in_bbox(float(center_lat), float(center_lon), box)
            or _bbox_overlap_fraction(candidate["bbox"], box) >= 0.5
        )

    def _intersects_any_place_box(candidate: Mapping) -> bool:
        return any(
            _bbox_intersects(candidate["bbox"], box) for box in place_boxes
        )

    def _place_tier(candidate: Mapping) -> int | None:
        if int(candidate.get("cells", 0)) < min_place_cells:
            return None
        if _is_preferred_country(candidate):
            return 0
        if _in_box(candidate, mekong_box):
            return 1
        if _in_box(candidate, southeast_box):
            return 2
        if _intersects_any_place_box(candidate):
            return 3
        return None

    def _place_pool(tier: int) -> list[Mapping]:
        return [
            candidate
            for candidate in ordered
            if _candidate_key(candidate) not in used
            and _place_tier(candidate) == tier
        ]

    if not any(_is_preferred_country(candidate) for candidate in selected):
        for tier in (0, 1, 2, 3):
            if tier == 1 and any(
                _in_box(candidate, mekong_box) for candidate in selected
            ):
                break
            if tier == 2 and any(
                _in_box(candidate, southeast_box) for candidate in selected
            ):
                break
            if tier == 3 and any(
                _intersects_any_place_box(candidate) for candidate in selected
            ):
                break
            pool = _place_pool(tier)
            if pool:
                add(pool[0], "southeast-asia")
                break

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
    payload = {
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
    witness = _witness_json(stats)
    if witness is not None:
        payload["witness"] = witness
    return payload


def _witness_json(stats: Mapping) -> dict | None:
    """Contract section 13 witness object, or None when no witness was read."""

    witness = stats.get("witness")
    if not witness:
        return None
    return {
        "product": str(witness.get("product", "")),
        "variable": str(witness.get("variable", "")),
        "sen_slope_decade": _round(witness.get("sen_slope_decade")),
        "slope_unit": str(witness.get("slope_unit", "")),
        "q_value": _round(witness.get("q_value"), 8),
        "agreement": int(witness.get("agreement", contract.INSUFFICIENT_DATA)),
    }


def _title(candidate: Mapping, variables: Mapping[str, Mapping], place: str) -> str:
    place_phrase = f"near {place}" if "\N{DEGREE SIGN}" in place else f"across {place}"
    if candidate.get("kind") == "caution":
        if candidate.get("caution_type") == "witness_disagreement":
            return "Is the air drying? The second witness says no"
        break_year = candidate.get("break_year")
        year_text = (
            f"{int(round(float(break_year)))}"
            if break_year is not None
            else "recent"
        )
        return f"{place} is warming \N{EM DASH} but check the {year_text} jump"
    if candidate.get("kind") == "pattern":
        wording = _PATTERN_WORDING.get(
            int(candidate.get("pattern_code", 0)), "a combined trend pattern"
        )
        return f"{wording.capitalize()} {place_phrase}"
    variable_id = candidate["variable"]
    variable_name = _plain_variable_name(variable_id, variables)
    if variable_id == DEFAULT_PRECIPITATION_VARIABLE:
        return f"Satellite rainfall is {_direction_verb(candidate['trend_class'])} {place_phrase}"
    variable_name = variable_name[:1].upper() + variable_name[1:]
    return f"{variable_name} is {_direction_verb(candidate['trend_class'])} {place_phrase}"


def _direction_verb(trend_class: int) -> str:
    return "rising" if trend_class == contract.TREND_INCREASE else "falling"


def _window_phrase(window: str) -> str:
    parts = str(window).split("-")
    if len(parts) != 2:
        return f"In {window}"
    start, end = parts
    if end == "2024":
        return f"Since {start}"
    return f"Between {start} and {end}"


def _plain_variable_name(variable_id: str, variables: Mapping[str, Mapping]) -> str:
    if variable_id == DEFAULT_PRECIPITATION_VARIABLE:
        return "satellite rainfall"
    if variable_id == "air_temperature":
        return "air temperature"
    label = str(
        variables.get(variable_id, {}).get("label", variable_id.replace("_", " "))
    )
    label = label.split(" (")[0].strip()
    return label[:1].lower() + label[1:] if label else variable_id


def _plain_unit(unit: str) -> str:
    text = unit.replace("mm/month", "mm per month")
    text = text.replace("degC", "\N{DEGREE SIGN}C")
    text = text.replace("per decade", "each decade")
    return text


def _slope_summary(stats: Mapping, variables: Mapping[str, Mapping]) -> str:
    value = stats.get("sen_slope_decade")
    if value is None:
        return "changed"
    unit = _plain_unit(_slope_unit(variables.get(stats["variable"], {})))
    magnitude = f"{abs(float(value)):.2g}"
    verb = "risen" if float(value) > 0 else "fallen"
    return f"{verb} by about {magnitude} {unit}"


def _caution_witness_ending(candidate: Mapping) -> str:
    """Section 13 combined reading for the Vietnam caution summary.

    Code 2: the independent dataset shows the same warming, so the trend is
    more likely real.  Any weaker or opposing code: the sudden shift was not
    confirmed, so the trend is more likely a data artefact.  With no witness
    layer the original caution close is kept.
    """

    evidence = candidate.get("evidence") or []
    witness = evidence[0].get("witness") if evidence else None
    if not witness:
        return "read the trend with caution."
    label = str(witness.get("label") or "an independent NASA dataset")
    if int(witness.get("agreement", 0)) == contract.WITNESS_CORROBORATED:
        return (
            f"{label} shows the same warming, so the trend is more likely real."
        )
    return (
        f"{label} does not show the same warming, so the trend is more likely "
        "a data artefact."
    )


def _formula_score(candidate: Mapping) -> float:
    """Score that matches the written formula, before the witness factor."""

    if candidate.get("score_before_witness") is not None:
        return float(candidate["score_before_witness"])
    return float(candidate.get("score", 0.0))


def _witness_rule_sentence(candidate: Mapping) -> str:
    """One sentence explaining the witness ranking rule for ``details``."""

    corroborated = candidate.get("witness_corroborated_share")
    contradicted = candidate.get("witness_contradicted_share")
    if corroborated is None and contradicted is None:
        return (
            "Witness rule: no witness agreement layer was available, so the "
            "score was not multiplied by (0.5 + 0.5 x corroborated share) and "
            "the finding was not rejected for contradiction."
        )
    corroborated_text = (
        "unavailable" if corroborated is None else f"{float(corroborated):.0%}"
    )
    contradicted_text = (
        "unavailable" if contradicted is None else f"{float(contradicted):.0%}"
    )
    factor = float(candidate.get("witness_score_factor", 1.0))
    return (
        "Witness rule: finding scores are multiplied by (0.5 + 0.5 x "
        f"corroborated share of {corroborated_text}, factor {factor:.2f}) so "
        "corroborated clusters win ties, and a finding is never selected when "
        "its contradicted share (agreement code -2) is above 50% "
        f"(here {contradicted_text})."
    )


def _summary_sentence(
    candidate: Mapping,
    variables: Mapping[str, Mapping],
    place: str,
) -> str:
    window_phrase = _window_phrase(str(candidate["window"]))
    cells = int(candidate.get("cells", 0))
    evidence = candidate["evidence"]
    place_phrase = _as_place_phrase(place)

    if candidate.get("kind") == "caution":
        stats = evidence[0]
        if candidate.get("caution_type") == "witness_disagreement":
            main_share = candidate.get("main_decrease_fraction")
            witness_share = candidate.get("witness_increase_fraction")
            contradicted = candidate.get("witness_contradicted_share")
            witness = evidence[0].get("witness") or {}
            witness_label = str(
                witness.get("label") or "the independent NASA dataset"
            )
            witness_variable = str(witness.get("variable") or "witness")
            if (
                main_share is None
                or witness_share is None
                or contradicted is None
            ):
                return (
                    "The second witness disagrees with the GLDAS trend; read "
                    "the evidence with caution."
                )
            return (
                f"{window_phrase}, GLDAS {_plain_variable_name(stats['variable'], variables)} "
                f"falls across {float(main_share):.1%} of global land, while "
                f"{witness_label} {witness_variable} rises across "
                f"{float(witness_share):.1%}; {float(contradicted):.1%} of "
                "GLDAS's significant area is contradicted by the witness."
            )

        stats = evidence[0]
        share = float(candidate.get("quality_flag_share", 0.0))
        break_year = candidate.get("break_year")
        year_text = (
            f"{int(round(float(break_year)))}"
            if break_year is not None
            else "the documented change period"
        )
        variable_name = _plain_variable_name(stats["variable"], variables)
        shift = candidate.get("lasting_shift") or {}
        witness = stats.get("witness") or {}
        main_slope = stats.get("sen_slope_decade")
        witness_slope = witness.get("sen_slope_decade")
        witness_q = witness.get("q_value")
        witness_label = str(witness.get("label") or "an independent NASA dataset")
        if (
            candidate.get("caution_type") == "vietnam_temperature"
            and shift.get("main") is not None
            and shift.get("witness") is not None
            and main_slope is not None
            and witness_slope is not None
        ):
            significance = (
                "not significant"
                if witness_q is not None and float(witness_q) >= contract.Q_THRESHOLD
                else "significant"
            )
            return (
                f"Since 2001, GLDAS shows {place} warming by about "
                f"{float(main_slope):.2f} \N{DEGREE SIGN}C per decade, but "
                f"{share:.0%} of the area jumps around {year_text} inside a "
                "documented GLDAS input change. The independent "
                f"{witness_label} sees the same year-to-year swings yet only "
                f"{float(witness_slope):+.2f} \N{DEGREE SIGN}C per decade "
                f"({significance}) and almost no lasting shift after "
                f"{year_text} ({float(shift['witness']):+.2f} \N{DEGREE SIGN}C "
                f"vs {float(shift['main']):+.2f} \N{DEGREE SIGN}C), so much of "
                "this warming is more likely a data artefact."
            )
        return (
            f"{window_phrase}, {variable_name} {place_phrase} has "
            f"{_slope_summary(stats, variables)}, but {share:.0%} of the area "
            f"shows a sudden shift around {year_text}, inside the documented "
            "GLDAS 2008\N{EN DASH}2012 input change; "
            f"{_caution_witness_ending(candidate)}"
        )

    if candidate.get("kind") == "pattern":
        temperature_stats, moisture_stats = evidence
        temperature_name = _plain_variable_name(
            temperature_stats["variable"], variables
        )
        moisture_name = _plain_variable_name(moisture_stats["variable"], variables)
        return (
            f"{window_phrase}, {temperature_name} {place_phrase} has "
            f"{_slope_summary(temperature_stats, variables)} while "
            f"{moisture_name} has {_slope_summary(moisture_stats, variables)} "
            f"across {cells} grid cells."
        )

    stats = evidence[0]
    variable_name = _plain_variable_name(stats["variable"], variables)
    return (
        f"{window_phrase}, {variable_name} {place_phrase} has "
        f"{_slope_summary(stats, variables)} across {cells} grid cells."
    )


def _why_selected(candidate: Mapping, variables: Mapping[str, Mapping]) -> str:
    evidence = candidate["evidence"]
    role = candidate.get("role", "")
    area = float(candidate.get("area_weight", 0.0))
    cells = int(candidate.get("cells", 0))
    flagged = float(candidate.get("quality_flag_share", 0.0))
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
    if candidate.get("kind") == "caution":
        break_year = candidate.get("break_year")
        year_text = (
            f"{float(break_year):.1f}" if break_year is not None else "undefined"
        )
        if candidate.get("caution_type") == "witness_disagreement":
            main_share = candidate.get("main_decrease_fraction")
            witness_share = candidate.get("witness_increase_fraction")
            contradicted = candidate.get("witness_contradicted_share")
            witness = stats.get("witness") or {}
            text = (
                f"Global caution case for {variable_label} in {window}: "
                f"{cells} significant decreasing GLDAS cells "
                f"(cos-latitude area {area:.2f}); median Sen slope "
                f"{_format_slope(stats, variables)}; median q = "
                f"{_format_number(stats.get('q_value'))}; quality-flag share "
                f"is {flagged:.0%}. GLDAS decreasing area is "
                f"{float(main_share or 0.0):.1%} of evaluated land; the "
                f"independent {witness.get('label', 'witness')} "
                f"{witness.get('variable', '')} increases over "
                f"{float(witness_share or 0.0):.1%}; contradicted share is "
                f"{float(contradicted or 0.0):.1%}. Witness majority code = "
                f"{int(witness.get('agreement', contract.INSUFFICIENT_DATA))}."
            )
        else:
            text = (
                f"Caution case built from the whole {candidate.get('label')} country "
                f"domain: {cells} evaluated cells of {variable_label} in {window} "
                f"(cos-latitude area {area:.2f}), with flagged cells NOT excluded. "
                f"Median Sen slope {_format_slope(stats, variables)}; median q = "
                f"{_format_number(stats.get('q_value'))}; "
                f"{significant_share:.0%} of the evaluated country cells are "
                f"significant; quality-flag share is {flagged:.0%}; median break "
                f"year is {year_text}. The documented GLDAS input change is "
                "2008\N{EN DASH}2012. "
                f"Score = area x |standardized change| x (1 - flag share) x "
                f"significant share = {_formula_score(candidate):.3f}."
            )
            shift = candidate.get("lasting_shift") or {}
            if shift.get("main") is not None and shift.get("witness") is not None:
                text += (
                    f" Lasting shift at {year_text}: main "
                    f"{float(shift['main']):+.2f} \N{DEGREE SIGN}C vs witness "
                    f"{float(shift['witness']):+.2f} \N{DEGREE SIGN}C"
                )
                if shift.get("annual_correlation") is not None:
                    text += (
                        f"; annual-series correlation "
                        f"{float(shift['annual_correlation']):.2f}"
                    )
                text += "."
    elif candidate.get("kind") == "country":
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
            f"significant share = {_formula_score(candidate):.3f}."
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
            f"= {_formula_score(candidate):.3f}."
        )
    if candidate.get("kind") == "caution":
        if candidate.get("caution_type") == "witness_disagreement":
            text += (
                " This is one of two caution cases: the significant GLDAS "
                "decrease is not corroborated by the independent witness, so "
                "read the evidence rather than treat the trend as a clean finding."
            )
        else:
            text += (
                " This is the local caution case: it shows a significant country-wide "
                "trend whose cells are largely flagged, so the reader should check "
                "the evidence rather than treat the trend as a clean finding."
            )
    elif role in {"opposite-pair-increasing", "opposite-pair-decreasing"}:
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
            " It is the Southeast Asia slot, chosen after preferring Vietnam, "
            "then the Mekong box, then the remaining Southeast Asia candidates."
        )
    if float(candidate.get("score_adjustment", 1.0)) != 1.0:
        text += (
            " Score down-weighted by "
            f"x{float(candidate['score_adjustment']):g}: "
            f"{candidate.get('score_adjustment_reason', '')}"
        )
    if candidate.get("kind") != "caution":
        text += " " + _witness_rule_sentence(candidate)
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
    is_global_caution = (
        candidate.get("kind") == "caution"
        and candidate.get("caution_type") == "witness_disagreement"
    )
    for stats in candidate["evidence"]:
        for caveat in variables.get(stats["variable"], {}).get("caveats", []) or []:
            text = str(caveat)
            if is_global_caution and text == (
                "Meteorological forcing field used to drive the GLDAS model."
            ):
                text = (
                    "Specific humidity is a GLDAS forcing input, so the documented "
                    "2008\N{EN DASH}2012 input change acts on it directly."
                )
            if text not in caveats:
                caveats.append(text)

    if candidate.get("kind") == "country" or (
        candidate.get("kind") == "caution" and not is_global_caution
    ):
        caveats.append(
            "A country domain follows a political boundary, not a climate region; "
            "the numbers aggregate cells inside that boundary."
        )
    elif not is_global_caution:
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
        flagged = float(candidate.get("quality_flag_share", 0.0))
        if flagged > 0.0:
            if candidate.get("kind") == "caution":
                caveats.append(
                    f"{flagged:.0%} of the cells carry a sudden-shift flag; they "
                    "are included on purpose so the reader can see the effect."
                )
            else:
                caveats.append(
                    f"{flagged:.0%} of the cells in the source component carry a "
                    "possible data-discontinuity flag (quality_flag >= 1); flagged "
                    "cells were excluded from the evidence."
                )
    quality_check_windows = list(candidate.get("quality_check_windows", []))
    if (
        candidate.get("window") != "2001-2024"
        and "2001-2024" in quality_check_windows
    ):
        caveats.append(EARLY_WINDOW_QUALITY_LIMITATION)
    for stats in candidate["evidence"]:
        note = str((stats.get("witness") or {}).get("limitation") or "")
        if note and note not in caveats:
            caveats.append(note)
    return caveats


def _case_from_candidate(
    candidate: Mapping,
    index: int,
    registry: Mapping | Sequence,
    *,
    overrides: Mapping[str, Mapping] | None = None,
    countries: Sequence[Mapping] = (),
    country_grid: np.ndarray | None = None,
) -> dict:
    variables = {
        variable_id: _variable_meta(registry, variable_id)
        for variable_id in candidate["variables"]
    }
    evidence = [
        _evidence_json(stats, variables[stats["variable"]])
        for stats in candidate["evidence"]
    ]
    place = _place_name(candidate, countries, country_grid)
    summary = _summary_sentence(candidate, variables, place)
    details = _why_selected(candidate, variables)
    bbox = [float(value) for value in candidate["bbox"]]
    region_id = candidate.get("region_id")
    if bbox[0] > bbox[2] and region_id != "global":
        cols = candidate.get("cols")
        if cols is not None and len(cols):
            longitudes = contract.LON_WEST_CENTER + np.asarray(cols) * contract.RESOLUTION_DEG
            crosses = bool((longitudes > 150.0).any() and (longitudes < -150.0).any())
            if not crosses:
                bbox = [
                    float(np.min(longitudes) - 0.5),
                    bbox[1],
                    float(np.max(longitudes) + 0.5),
                    bbox[3],
                ]
    region = {
        "bbox": bbox,
        "label": place,
    }
    if isinstance(region_id, str) and region_id:
        region["id"] = region_id
    case = {
        "id": f"case-{index:02d}",
        "title": _title(candidate, variables, place),
        "region": region,
        "window": str(candidate["window"]),
        "kind": "caution" if candidate.get("kind") == "caution" else "finding",
        "summary": summary,
        "details": details,
        "why_selected": summary,
        "quality_flag_share": _round(candidate.get("quality_flag_share", 0.0)),
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
            wording = override["why_selected"].strip()
            case["summary"] = wording
            case["why_selected"] = wording
    return case


def build_cases_file(
    selected: Sequence[Mapping],
    registry: Mapping | Sequence,
    *,
    config: Mapping | None = None,
    countries: Sequence[Mapping] = (),
    country_grid: np.ndarray | None = None,
) -> dict:
    """Format selected candidates as the contract section 9 JSON object."""

    config = config or {}
    overrides = config.get("overrides", {}) or {}
    selection_method = str(
        config.get("selection_method") or DEFAULT_SELECTION_METHOD
    )
    cases = [
        _case_from_candidate(
            candidate,
            index,
            registry,
            overrides=overrides,
            countries=countries,
            country_grid=country_grid,
        )
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
    "DEFAULT_PREFERRED_COUNTRY_IDS",
    "DEFAULT_SELECTION_METHOD",
    "DEFAULT_TARGET_CASES",
    "DEFAULT_TRENDS_DIR",
    "DEFAULT_WINDOW_PRIORITY_BONUS",
    "EARLY_WINDOW_QUALITY_LIMITATION",
    "build_cases_file",
    "build_caution_candidate",
    "cluster_components",
    "combine_quality_flags",
    "country_candidates",
    "dominant_country_label",
    "dumps_cases",
    "latitude_weights",
    "load_cases_config",
    "pattern_candidates",
    "place_label",
    "select_cases",
    "trend_candidates",
    "witness_agreement_grid",
    "witness_metadata",
    "write_cases",
]
