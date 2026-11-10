"""P-EXPORT: write P02/P03/P03b results into the EarthPulse web data contract.

The module is deliberately separate from the CLI scripts:

- :func:`export_all` reads the pipeline NetCDFs and writes a complete
  ``data/export/web_data/`` tree following ``docs/DATA_CONTRACT.md``.
- :func:`validate_export` proves that a data folder obeys the contract.
- :func:`publish_export` copies a validated folder into ``web/public/data``.

The export never writes directly into ``web/public/data``; only the explicit
publish step does that. It also never invents values: every number comes from
P02/P03/P03b outputs or the architect-owned registry/config files.
"""

from __future__ import annotations

import json
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

import numpy as np
import xarray as xr
import yaml

from earthpulse import contract
from earthpulse.patterns import pattern_class
from earthpulse.quality import annual_means, quality_grid
from earthpulse.regions import build_country_grid, country_cells_in_mask
from earthpulse.screener import domain_mask, screener_table
from earthpulse.witness_agreement import (
    WITNESS_AGREEMENT_CODES,
    index_products,
    read_trend_layers,
    witness_layers,
    witness_screener_fields,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = PROJECT_ROOT / "config" / "variables.yaml"
REGIONS_PATH = PROJECT_ROOT / "config" / "regions.yaml"
COUNTRIES_PATH = PROJECT_ROOT / "config" / "countries" / "countries-50m.geojson"
INTERIM_DIR = PROJECT_ROOT / "data" / "interim" / "harmonized_monthly"
ANOMALY_DIR = PROJECT_ROOT / "data" / "processed" / "anomalies"
TRENDS_DIR = PROJECT_ROOT / "data" / "processed" / "trends"
CORRELATIONS_DIR = PROJECT_ROOT / "data" / "processed" / "correlations"
WITNESS_DIR = PROJECT_ROOT / "data" / "processed" / "witness"
WITNESS_TRENDS_DIR = WITNESS_DIR / "trends"
WITNESS_ANOMALY_DIR = WITNESS_DIR / "anomalies"
EXPORT_DIR = PROJECT_ROOT / "data" / "export" / "web_data"
WEB_DATA_DIR = PROJECT_ROOT / "web" / "public" / "data"

# Shared constant (P14 bumps contract.py/contract.ts to 1.3 for the second witness).
EXPORT_SCHEMA_VERSION = contract.SCHEMA_VERSION

FLOAT_DTYPE = np.dtype("<f4")
CLASS_DTYPE = np.dtype("i1")
GRID_VALUE_COUNT = contract.N_ROWS * contract.N_COLS
TILE_VALUE_COUNT = contract.N_MONTHS * contract.TILE_SIZE * contract.TILE_SIZE
CLIMATOLOGY_MONTHS = 12
CLIMATOLOGY_VALUE_COUNT = CLIMATOLOGY_MONTHS * GRID_VALUE_COUNT

TREND_CLASS_CODES = frozenset(
    {
        contract.OUTSIDE_DOMAIN,
        contract.INSUFFICIENT_DATA,
        contract.TREND_DECREASE,
        contract.TREND_NOT_SIGNIFICANT,
        contract.TREND_INCREASE,
    }
)
PATTERN_CLASS_CODES = frozenset(
    {
        contract.OUTSIDE_DOMAIN,
        contract.INSUFFICIENT_DATA,
        contract.PATTERN_MIXED,
        contract.PATTERN_WARMING_DRYING,
        contract.PATTERN_WARMING_WETTING,
        contract.PATTERN_COOLING_DRYING,
        contract.PATTERN_COOLING_WETTING,
    }
)

PATTERN_PAIR = {
    "temperature": "surface_skin_temperature",
    "moisture": "root_zone_soil_moisture",
}

QUALITY_CLASS_CODES = frozenset(
    {
        contract.QUALITY_NONE,
        contract.QUALITY_STEP,
        contract.QUALITY_STEP_KNOWN_FORCING,
        contract.INSUFFICIENT_DATA,
        contract.OUTSIDE_DOMAIN,
    }
)
COUNTRY_KEYS = {"id", "label", "iso_numeric", "index", "n_cells", "bbox"}
REGIONS_FILE_KEYS = {"regions"}
# Optional schema-1.2 fields. The validator accepts them when present.
SCREENER_ROW_OPTIONAL_KEYS = {
    "step_flag_area_fraction",
    "sig_trend_flagged_fraction",
    "witness_corroborated_fraction",
    "witness_contradicted_fraction",
}
REGIONS_FILE_OPTIONAL_KEYS = {"countries", "country_grid", "synthetic"}

TARGET_LAT = contract.LAT_NORTH_CENTER - np.arange(
    contract.N_ROWS, dtype=float
) * contract.RESOLUTION_DEG
TARGET_LON = contract.LON_WEST_CENTER + np.arange(
    contract.N_COLS, dtype=float
) * contract.RESOLUTION_DEG
LAT_WEIGHTS = np.cos(np.deg2rad(TARGET_LAT))

INDEX_KEYS = {
    "schema_version",
    "generated_at",
    "synthetic",
    "grid",
    "months",
    "baseline",
    "windows",
    "q_threshold",
    "variables",
    "pattern_pair",
    "correlation_pairs",
    "layers",
    "tiles",
}
VARIABLE_KEYS = {
    "id",
    "label",
    "category",
    "product",
    "product_version",
    "doi",
    "source_type",
    "source_variable",
    "display_unit",
    "slope_unit",
    "description",
    "caveats",
    "core",
    "increase_means",
}
SCREENER_KEYS = {"window", "domain", "synthetic", "rows"}
SCREENER_ROW_KEYS = {
    "variable",
    "valid_area_fraction",
    "sig_increase_area_fraction",
    "sig_decrease_area_fraction",
    "median_abs_std_change_decade",
    "median_sen_slope_decade_sig",
    "regional_contrast",
    "n_cells_evaluated",
}
INDEX_OPTIONAL_KEYS = {"quality", "witness"}
REGION_SERIES_KEYS = {
    "region",
    "variable",
    "synthetic",
    "unit",
    "months",
    "values",
    "anomalies",
    "valid_cell_fraction",
}
REGION_SERIES_OPTIONAL_KEYS = {"witness_anomalies", "witness_unit"}
WITNESS_PRODUCT_KEYS = {
    "product",
    "version",
    "source_variable",
    "doi",
    "label",
}
CASE_FILE_KEYS = {"synthetic", "selection_method", "cases"}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def month_labels() -> list[str]:
    """Contract month labels ``2001-01`` ... ``2024-12``."""
    start_year, start_month = (int(part) for part in contract.FIRST_MONTH.split("-"))
    labels: list[str] = []
    year, month = start_year, start_month
    for _ in range(contract.N_MONTHS):
        labels.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year += 1
            month = 1
    return labels


def _timestamp() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _write_json(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, separators=(",", ":"), allow_nan=False)
    path.write_text(text, encoding="utf-8")


def _write_binary(path: Path, array: np.ndarray, dtype: np.dtype) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    contiguous = np.ascontiguousarray(array, dtype=dtype.newbyteorder("<"))
    contiguous.tofile(path)


def _round_or_none(value: float | None) -> float | None:
    if value is None:
        return None
    value = float(value)
    if not np.isfinite(value):
        return None
    return round(value, 4)


def _json_values(array: np.ndarray) -> list[float | None]:
    return [_round_or_none(float(value)) for value in np.asarray(array).ravel()]


def _month_label(value: object) -> str:
    if isinstance(value, np.datetime64):
        return str(value)[:7]
    year = getattr(value, "year", None)
    month = getattr(value, "month", None)
    if year is not None and month is not None:
        return f"{int(year):04d}-{int(month):02d}"
    return str(value)[:7]


def _check_coordinate_offsets(
    values: np.ndarray, target: np.ndarray, name: str, label: str
) -> None:
    source = np.asarray(values, dtype=float)
    if source.size == 0:
        raise ValueError(f"{label}: empty {name} coordinate")
    offsets = np.min(np.abs(source[:, None] - target[None, :]), axis=1)
    if float(offsets.max()) > 1e-3:
        raise ValueError(
            f"{label}: {name} coordinates are not on the contract grid "
            f"(max offset {offsets.max():.3e}); refusing to shift data"
        )


def _normalise_grid(da: xr.DataArray, label: str) -> xr.DataArray:
    """Transpose to ``(..., lat, lon)`` and reindex to the contract grid."""
    if "lat" not in da.dims or "lon" not in da.dims:
        raise ValueError(f"{label}: expected lat/lon dimensions, got {da.dims}")
    order = tuple(dim for dim in ("time", "month", "lat", "lon") if dim in da.dims)
    if tuple(da.dims) != order:
        da = da.transpose(*order)
    if da.sizes["lat"] != contract.N_ROWS or da.sizes["lon"] != contract.N_COLS:
        raise ValueError(
            f"{label}: expected contract grid {contract.N_ROWS}x{contract.N_COLS}, "
            f"got {da.sizes['lat']}x{da.sizes['lon']}"
        )
    if "lat" in da.coords:
        _check_coordinate_offsets(
            np.asarray(da["lat"].values), TARGET_LAT, "lat", label
        )
    if "lon" in da.coords:
        _check_coordinate_offsets(
            np.asarray(da["lon"].values), TARGET_LON, "lon", label
        )
    if "lat" in da.coords and "lon" in da.coords:
        da = da.reindex(
            lat=TARGET_LAT, lon=TARGET_LON, method="nearest", tolerance=1e-3
        )
    return da


def _load_grid(ds: xr.Dataset, name: str, label: str, dtype=np.float64) -> np.ndarray:
    if name not in ds:
        raise ValueError(f"{label}: missing variable {name!r}")
    da = _normalise_grid(ds[name], f"{label}/{name}")
    return np.asarray(da.values, dtype=dtype)


def _load_monthly(
    ds: xr.Dataset, name: str, label: str, months: Sequence[str]
) -> np.ndarray:
    if name not in ds:
        raise ValueError(f"{label}: missing variable {name!r}")
    da = _normalise_grid(ds[name], f"{label}/{name}")
    if "time" not in da.dims:
        raise ValueError(f"{label}/{name}: expected a time dimension")
    if da.sizes["time"] != len(months):
        raise ValueError(
            f"{label}/{name}: expected {len(months)} months, got {da.sizes['time']}"
        )
    if "time" in da.coords:
        labels = [_month_label(value) for value in np.asarray(da["time"].values)]
        if list(labels) != list(months):
            raise ValueError(
                f"{label}/{name}: time labels do not match the contract months"
            )
    return np.asarray(da.values, dtype=np.float32)


def _load_climatology(
    ds: xr.Dataset, name: str, label: str
) -> np.ndarray:
    """Load the P02 ``climatology (month, lat, lon)`` baseline cube."""
    if name not in ds:
        raise ValueError(f"{label}: missing variable {name!r}")
    da = _normalise_grid(ds[name], f"{label}/{name}")
    if "month" not in da.dims:
        raise ValueError(f"{label}/{name}: expected a month dimension")
    if da.sizes["month"] != CLIMATOLOGY_MONTHS:
        raise ValueError(
            f"{label}/{name}: expected {CLIMATOLOGY_MONTHS} calendar months, "
            f"got {da.sizes['month']}"
        )
    if "month" in da.coords:
        found = [int(value) for value in np.asarray(da["month"].values)]
        if found != list(range(1, CLIMATOLOGY_MONTHS + 1)):
            if set(found) == set(range(1, CLIMATOLOGY_MONTHS + 1)):
                da = da.reindex(month=np.arange(1, CLIMATOLOGY_MONTHS + 1))
            else:
                raise ValueError(
                    f"{label}/{name}: month coordinate is not 1..12: {found}"
                )
    return np.asarray(da.values, dtype=np.float32)


def _check_class_codes(
    values: np.ndarray, allowed: frozenset[int], label: str
) -> None:
    found = {int(code) for code in np.unique(values)}
    bad = sorted(found - allowed)
    if bad:
        raise ValueError(f"{label}: illegal class codes {bad}")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def load_registry(path: str | Path | None = None) -> dict:
    with open(path or REGISTRY_PATH, encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def load_regions(path: str | Path | None = None) -> list[dict]:
    with open(path or REGIONS_PATH, encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    regions = data.get("regions", [])
    for region in regions:
        bbox = region.get("bbox")
        if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            raise ValueError(f"region {region.get('id')!r} has an invalid bbox")
    return list(regions)


def verified_variables(
    registry: dict, variable_ids: Sequence[str] | None = None
) -> list[dict]:
    variables = [
        variable
        for variable in registry.get("variables", [])
        if variable.get("verified") is True
    ]
    if variable_ids is None:
        return variables
    requested = list(dict.fromkeys(variable_ids))
    by_id = {variable["id"]: variable for variable in variables}
    missing = [variable_id for variable_id in requested if variable_id not in by_id]
    if missing:
        raise KeyError(f"unknown or unverified variable ids: {missing}")
    return [by_id[variable_id] for variable_id in requested]


def _index_variable(variable: dict, products: dict) -> dict:
    product_name = variable["product"]
    if product_name not in products:
        raise KeyError(
            f"variable {variable['id']!r} references unknown product {product_name!r}"
        )
    product = products[product_name]
    display_unit = variable["display_unit"]
    return {
        "id": variable["id"],
        "label": variable["label"],
        "category": variable["category"],
        "product": product_name,
        "product_version": product["version"],
        "doi": product.get("doi"),
        "source_type": product.get("source_type"),
        "source_variable": variable["source_variable"],
        "display_unit": display_unit,
        "slope_unit": f"{display_unit} per year",
        "description": variable["description"],
        "caveats": list(variable.get("caveats", [])),
        "core": bool(variable.get("core", False)),
        "increase_means": variable["increase_means"],
    }


def _resolve_mask_path(interim_dir: Path, anomaly_dir: Path) -> Path:
    """P02 writes the mask next to the harmonized cubes; P03 also expects a copy
    next to the anomalies. Accept either location."""
    candidates = [
        interim_dir / "common_mask.nc",
        anomaly_dir / "common_mask.nc",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(
        "common_mask.nc not found in either location: "
        + ", ".join(str(path) for path in candidates)
    )


def _load_common_mask(path: str | Path) -> np.ndarray:
    with xr.open_dataset(path, engine="netcdf4") as ds:
        if "common_mask" in ds:
            da = ds["common_mask"]
        else:
            names = list(ds.data_vars)
            if len(names) != 1:
                raise ValueError(
                    f"{path}: expected a 'common_mask' variable or exactly one "
                    f"data variable, found {names}"
                )
            da = ds[names[0]]
        values = np.asarray(_normalise_grid(da, f"{path}/common_mask").values)
    return values.astype(bool)


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------


def export_grids(
    trends_dir: Path,
    out_dir: Path,
    variable_ids: Sequence[str],
    window_ids: Sequence[str],
    mask: np.ndarray,
) -> dict[tuple[str, str], dict[str, np.ndarray]]:
    """Write every trend layer and return the arrays needed by the screener."""
    cache: dict[tuple[str, str], dict[str, np.ndarray]] = {}
    for variable_id in variable_ids:
        for window_id in window_ids:
            path = trends_dir / variable_id / f"{window_id}.nc"
            if not path.is_file():
                raise FileNotFoundError(f"P03 trend file missing: {path}")
            label = f"{variable_id}/{window_id}"
            with xr.open_dataset(path, engine="netcdf4") as ds:
                kept: dict[str, np.ndarray] = {}
                for layer in contract.FLOAT_LAYERS:
                    values = _load_grid(ds, layer, label).astype(np.float64)
                    values = np.where(mask, values, np.nan).astype(np.float32)
                    _write_binary(
                        out_dir / "grids" / variable_id / window_id / f"{layer}.f32",
                        values,
                        FLOAT_DTYPE,
                    )
                    if layer in (
                        "std_change_decade",
                        "sen_slope",
                        "sen_slope_decade",
                        "q_value",
                    ):
                        kept[layer] = values
                classes = _load_grid(ds, "trend_class", label, dtype=np.int8)
                _check_class_codes(classes, TREND_CLASS_CODES, f"{label}/trend_class")
                if np.any(classes[mask] == contract.OUTSIDE_DOMAIN):
                    raise ValueError(
                        f"{label}/trend_class: -99 inside the common mask"
                    )
                classes = np.where(
                    mask, classes, contract.OUTSIDE_DOMAIN
                ).astype(np.int8)
                _write_binary(
                    out_dir / "grids" / variable_id / window_id / "trend_class.i8",
                    classes,
                    CLASS_DTYPE,
                )
                kept["trend_class"] = classes
            cache[(variable_id, window_id)] = kept
    return cache


def export_quality(
    cache: dict[tuple[str, str], dict[str, np.ndarray]],
    anomaly_dir: Path,
    out_dir: Path,
    variables: Sequence[dict],
    window_ids: Sequence[str],
    mask: np.ndarray,
) -> None:
    """Write schema-1.2 ``quality_flag`` and ``breakpoint_year`` layers.

    The step test uses annual means of the monthly anomalies inside each
    window. The P03 ``trend_class`` supplies the same eligibility decision as
    the trend layers (``-9`` cells are not quality-evaluated).
    """

    for variable in variables:
        variable_id = variable["id"]
        path = anomaly_dir / f"{variable_id}.nc"
        if not path.is_file():
            raise FileNotFoundError(f"P02 anomaly cube missing: {path}")
        with xr.open_dataset(path, engine="netcdf4") as ds:
            anomaly = np.asarray(ds["anomaly"].values, dtype=float)
            labels = np.asarray([_month_label(value) for value in ds["time"].values])
            years_all = np.asarray(ds["time"].dt.year.values, dtype=int)
        for window_id in window_ids:
            start, end = contract.WINDOWS[window_id]
            selection = (labels >= start) & (labels <= end)
            annual, years = annual_means(
                anomaly[selection], years_all[selection]
            )
            layers = cache[(variable_id, window_id)]
            result = quality_grid(
                annual,
                years,
                layers["trend_class"],
                mask,
                product=variable["product"],
            )
            _write_binary(
                out_dir / "grids" / variable_id / window_id / "quality_flag.i8",
                result["quality_flag"],
                CLASS_DTYPE,
            )
            _write_binary(
                out_dir / "grids" / variable_id / window_id / "breakpoint_year.f32",
                result["breakpoint_year"],
                FLOAT_DTYPE,
            )
            layers["quality_flag"] = result["quality_flag"]
            layers["breakpoint_year"] = result["breakpoint_year"]


def export_witness(
    cache: dict[tuple[str, str], dict[str, np.ndarray]],
    witness_trends_dir: Path,
    out_dir: Path,
    variables: Sequence[dict],
    window_ids: Sequence[str],
    mask: np.ndarray,
) -> dict:
    """Write schema-1.3 witness agreement layers and return index.witness."""
    for variable in variables:
        variable_id = variable["id"]
        for window_id in window_ids:
            path = witness_trends_dir / variable_id / f"{window_id}.nc"
            if not path.is_file():
                raise FileNotFoundError(f"P13 witness trend file missing: {path}")
            witness = read_trend_layers(path)
            layers = witness_layers(
                cache[(variable_id, window_id)],
                witness,
                mask,
            )
            _write_binary(
                out_dir
                / "grids"
                / variable_id
                / window_id
                / "witness_agreement.i8",
                layers["witness_agreement"],
                CLASS_DTYPE,
            )
            _write_binary(
                out_dir
                / "grids"
                / variable_id
                / window_id
                / "witness_std_change.f32",
                layers["witness_std_change"],
                FLOAT_DTYPE,
            )
            cache[(variable_id, window_id)].update(layers)
    return {
        "method": (
            "same Sen + Hamed–Rao MK + BH-FDR test on an independent NASA product"
        ),
        "layers": list(contract.WITNESS_LAYERS),
        "products": index_products([variable["id"] for variable in variables]),
    }


def export_countries(
    country_geojson_path: str | Path,
    out_dir: Path,
    mask: np.ndarray,
) -> tuple[list[dict], np.ndarray]:
    """Write the schema-1.2 country grid and return exportable countries.

    The grid contains every Natural Earth country index; the returned list is
    filtered to ``n_cells >= contract.COUNTRY_MIN_CELLS`` inside the common
    mask, as DATA_CONTRACT §11 requires.
    """

    grid, countries = build_country_grid(country_geojson_path)
    counts = country_cells_in_mask(grid, mask)
    exported = [
        {**country, "n_cells": counts.get(int(country["index"]), 0)}
        for country in countries
        if counts.get(int(country["index"]), 0) >= contract.COUNTRY_MIN_CELLS
    ]
    # Only listed countries are valid domains; small islands dropped by the
    # n_cells >= 3 rule become "no country" in the exported grid, so the UI and
    # validator never see an index without metadata.
    kept_indices = np.asarray([country["index"] for country in exported], dtype=np.int16)
    if kept_indices.size:
        exported_grid = np.where(np.isin(grid, kept_indices), grid, contract.COUNTRY_NONE)
    else:
        exported_grid = np.full_like(grid, contract.COUNTRY_NONE)
    _write_binary(
        out_dir / contract.COUNTRY_GRID_FILE,
        exported_grid.astype(np.int16),
        np.dtype("int16"),
    )
    return exported, exported_grid.astype(np.int16)


def quality_screener_fields(
    trend_class: np.ndarray,
    quality_flag: np.ndarray,
    domain: np.ndarray,
) -> dict[str, float | None]:
    """Optional schema-1.2 Screener fields for one variable/window/domain."""

    classes = np.asarray(trend_class)
    quality = np.asarray(quality_flag)
    area = np.asarray(domain, dtype=bool)
    if classes.shape != area.shape or quality.shape != area.shape:
        raise ValueError("trend_class, quality_flag and domain shapes differ")

    weights = LAT_WEIGHTS[:, None] * np.ones_like(area, dtype=float)
    evaluated = area & np.isin(
        classes,
        (
            contract.TREND_DECREASE,
            contract.TREND_NOT_SIGNIFICANT,
            contract.TREND_INCREASE,
        ),
    )
    significant = area & np.isin(
        classes, (contract.TREND_DECREASE, contract.TREND_INCREASE)
    )
    flagged = evaluated & (quality >= contract.QUALITY_STEP)
    flagged_significant = significant & (quality >= contract.QUALITY_STEP)

    evaluated_area = float(weights[evaluated].sum())
    significant_area = float(weights[significant].sum())
    step_fraction = (
        float(weights[flagged].sum()) / evaluated_area
        if evaluated_area > 0
        else None
    )
    sig_fraction = (
        float(weights[flagged_significant].sum()) / significant_area
        if significant_area > 0
        else None
    )
    return {
        "step_flag_area_fraction": step_fraction,
        "sig_trend_flagged_fraction": sig_fraction,
    }


def export_patterns(
    cache: dict[tuple[str, str], dict[str, np.ndarray]],
    out_dir: Path,
    window_ids: Sequence[str],
    mask: np.ndarray,
) -> None:
    temperature_id = PATTERN_PAIR["temperature"]
    moisture_id = PATTERN_PAIR["moisture"]
    for window_id in window_ids:
        try:
            temperature = cache[(temperature_id, window_id)]["trend_class"]
            moisture = cache[(moisture_id, window_id)]["trend_class"]
        except KeyError as exc:
            raise KeyError(
                f"pattern pair requires variables {temperature_id!r} and "
                f"{moisture_id!r} for window {window_id!r}"
            ) from exc
        patterns = pattern_class(temperature, moisture)
        patterns = np.where(mask, patterns, contract.OUTSIDE_DOMAIN).astype(np.int8)
        _write_binary(
            out_dir / "patterns" / window_id / "pattern_class.i8",
            patterns,
            CLASS_DTYPE,
        )


def discover_correlation_pairs(
    correlations_dir: Path, window_ids: Sequence[str]
) -> list[str]:
    if not correlations_dir.is_dir():
        return []
    pairs: list[str] = []
    for child in sorted(correlations_dir.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        parts = child.name.split("__")
        if len(parts) != 2 or parts[0] >= parts[1]:
            raise ValueError(
                f"correlation directory {child.name!r} is not an alphabetical pair"
            )
        missing = [
            window_id
            for window_id in window_ids
            if not (child / f"{window_id}.nc").is_file()
        ]
        if missing:
            raise FileNotFoundError(
                f"correlation pair {child.name!r} is missing windows: {missing}"
            )
        pairs.append(child.name)
    return pairs


def export_correlations(
    correlations_dir: Path,
    out_dir: Path,
    pair_ids: Sequence[str],
    window_ids: Sequence[str],
    mask: np.ndarray,
) -> None:
    for pair_id in pair_ids:
        for window_id in window_ids:
            path = correlations_dir / pair_id / f"{window_id}.nc"
            if not path.is_file():
                raise FileNotFoundError(f"P03 correlation file missing: {path}")
            label = f"{pair_id}/{window_id}"
            with xr.open_dataset(path, engine="netcdf4") as ds:
                for layer in contract.CORRELATION_LAYERS:
                    values = _load_grid(ds, layer, label).astype(np.float64)
                    values = np.where(mask, values, np.nan).astype(np.float32)
                    _write_binary(
                        out_dir
                        / "correlations"
                        / pair_id
                        / window_id
                        / f"{layer}.f32",
                        values,
                        FLOAT_DTYPE,
                    )


def export_screener(
    cache: dict[tuple[str, str], dict[str, np.ndarray]],
    out_dir: Path,
    variable_ids: Sequence[str],
    window_ids: Sequence[str],
    regions: Sequence[dict],
    mask: np.ndarray,
    countries: Sequence[dict] = (),
    country_grid: np.ndarray | None = None,
) -> None:
    # Compute each domain mask once and reuse it for every variable/window.
    domains: list[tuple[str, np.ndarray]] = [
        ("global", domain_mask("global", mask))
    ]
    domains.extend(
        (region["id"], domain_mask(tuple(region["bbox"]), mask))
        for region in regions
    )
    if countries:
        if country_grid is None:
            raise ValueError("country_grid is required when countries are exported")
        domains.extend(
            (country["id"], mask & (country_grid == country["index"]))
            for country in countries
        )

    for window_id in window_ids:
        per_variable: dict[str, dict[str, np.ndarray]] = {}
        for variable_id in variable_ids:
            layers = cache[(variable_id, window_id)]
            per_variable[variable_id] = {
                "trend_class": layers["trend_class"],
                "std_change_decade": layers["std_change_decade"],
                "sen_slope_decade": layers["sen_slope_decade"],
            }
        for domain_id, region_mask in domains:
            rows = screener_table(per_variable, region_mask)
            for row, variable_id in zip(rows, variable_ids):
                layers = cache[(variable_id, window_id)]
                quality = layers.get("quality_flag")
                if quality is not None:
                    row.update(
                        quality_screener_fields(
                            layers["trend_class"], quality, region_mask
                        )
                    )
                else:
                    row["step_flag_area_fraction"] = None
                    row["sig_trend_flagged_fraction"] = None
                agreement = layers.get("witness_agreement")
                if agreement is not None:
                    row.update(
                        witness_screener_fields(
                            layers["trend_class"], agreement, region_mask
                        )
                    )
                else:
                    row["witness_corroborated_fraction"] = None
                    row["witness_contradicted_fraction"] = None
            _write_json(
                out_dir / "screener" / window_id / f"{domain_id}.json",
                {
                    "window": window_id,
                    "domain": domain_id,
                    "synthetic": False,
                    "rows": rows,
                },
            )


def _weighted_region_series(
    values: np.ndarray, region_mask: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Area-weighted monthly mean and valid fraction for one region."""
    if values.shape[1:] != region_mask.shape:
        raise ValueError("values and region mask shapes differ")
    area_weights = LAT_WEIGHTS[:, None] * region_mask
    valid = np.isfinite(values) & region_mask[None, :, :]
    denominator = np.sum(area_weights[None, :, :] * valid, axis=(1, 2))
    numerator = np.nansum(
        np.where(valid, values, np.nan) * area_weights[None, :, :], axis=(1, 2)
    )
    total_area = float(area_weights.sum())
    with np.errstate(invalid="ignore", divide="ignore"):
        means = np.where(denominator > 0, numerator / denominator, np.nan)
        fractions = np.where(
            total_area > 0, denominator / total_area, np.nan
        )
    return means, fractions


def export_region_series(
    interim_dir: Path,
    anomaly_dir: Path,
    out_dir: Path,
    variables: Sequence[dict],
    regions: Sequence[dict],
    mask: np.ndarray,
    months: Sequence[str],
    countries: Sequence[dict] = (),
    country_grid: np.ndarray | None = None,
    witness_anomaly_dir: Path | None = None,
) -> None:
    region_masks = {
        region["id"]: domain_mask(tuple(region["bbox"]), mask)
        for region in regions
    }
    if countries:
        if country_grid is None:
            raise ValueError("country_grid is required when countries are exported")
        region_masks.update(
            {
                country["id"]: mask & (country_grid == country["index"])
                for country in countries
            }
        )
    domain_entries = [*regions, *countries]
    for variable in variables:
        variable_id = variable["id"]
        values_path = interim_dir / f"{variable_id}.nc"
        anomalies_path = anomaly_dir / f"{variable_id}.nc"
        if not values_path.is_file():
            raise FileNotFoundError(f"P02 harmonized cube missing: {values_path}")
        if not anomalies_path.is_file():
            raise FileNotFoundError(f"P02 anomaly cube missing: {anomalies_path}")

        with xr.open_dataset(values_path, engine="netcdf4") as ds:
            values = _load_monthly(
                ds, variable_id, f"{variable_id} values", months
            )
            units = ds.attrs.get("units") or ds[variable_id].attrs.get("units")
        with xr.open_dataset(anomalies_path, engine="netcdf4") as ds:
            anomalies = _load_monthly(
                ds, "anomaly", f"{variable_id} anomalies", months
            )
            anomaly_units = ds.attrs.get("units") or ds["anomaly"].attrs.get(
                "units"
            )

        witness_anomalies: np.ndarray | None = None
        witness_unit: str | None = None
        if witness_anomaly_dir is not None:
            witness_path = witness_anomaly_dir / f"{variable_id}.nc"
            if not witness_path.is_file():
                raise FileNotFoundError(
                    f"P13 witness anomaly cube missing: {witness_path}"
                )
            with xr.open_dataset(witness_path, engine="netcdf4") as ds:
                witness_anomalies = _load_monthly(
                    ds, "anomaly", f"{variable_id} witness anomalies", months
                )
                witness_unit = ds.attrs.get("units") or ds["anomaly"].attrs.get(
                    "units"
                )
            if not witness_unit:
                raise ValueError(
                    f"{variable_id} witness anomalies: missing a units attribute"
                )

        variable = next(
            candidate for candidate in variables
            if candidate["id"] == variable_id
        )
        expected_unit = variable["display_unit"]
        for label, found in (("values", units), ("anomalies", anomaly_units)):
            if found is not None and found != expected_unit:
                raise ValueError(
                    f"{variable_id} {label}: cube units {found!r} do not match "
                    f"registry display unit {expected_unit!r}"
                )

        for region in domain_entries:
            region_mask = region_masks[region["id"]]
            mean_values, fractions = _weighted_region_series(values, region_mask)
            mean_anomalies, _ = _weighted_region_series(anomalies, region_mask)
            entry = {
                "region": region["id"],
                "variable": variable_id,
                "synthetic": False,
                "unit": expected_unit,
                "months": list(months),
                "values": _json_values(mean_values),
                "anomalies": _json_values(mean_anomalies),
                "valid_cell_fraction": _json_values(fractions),
            }
            if witness_anomalies is not None:
                mean_witness, _ = _weighted_region_series(
                    witness_anomalies, region_mask
                )
                entry["witness_anomalies"] = _json_values(mean_witness)
                entry["witness_unit"] = witness_unit
            _write_json(
                out_dir
                / "series"
                / "regions"
                / region["id"]
                / f"{variable_id}.json",
                entry,
            )


def tiles_with_mask(mask: np.ndarray) -> list[tuple[str, int, int]]:
    tiles: list[tuple[str, int, int]] = []
    for row in range(0, contract.N_ROWS, contract.TILE_SIZE):
        for col in range(0, contract.N_COLS, contract.TILE_SIZE):
            if mask[
                row : row + contract.TILE_SIZE,
                col : col + contract.TILE_SIZE,
            ].any():
                tiles.append((f"r{row:03d}_c{col:03d}", row, col))
    return tiles


def export_climatology(
    anomaly_dir: Path,
    out_dir: Path,
    variable_ids: Sequence[str],
    mask: np.ndarray,
) -> None:
    """Write the schema 1.1 per-variable monthly climatology layer.

    The file is ``series/climatology/{variable}.f32`` with shape
    ``[12, 180, 360]`` (calendar month Jan..Dec, row, col), float32 LE.
    """
    for variable_id in variable_ids:
        path = anomaly_dir / f"{variable_id}.nc"
        if not path.is_file():
            raise FileNotFoundError(f"P02 anomaly cube missing: {path}")
        with xr.open_dataset(path, engine="netcdf4") as ds:
            climatology = _load_climatology(
                ds, "climatology", f"{variable_id} climatology"
            )
        if climatology.shape != (
            CLIMATOLOGY_MONTHS,
            contract.N_ROWS,
            contract.N_COLS,
        ):
            raise ValueError(
                f"{variable_id} climatology: expected shape "
                f"{(CLIMATOLOGY_MONTHS, contract.N_ROWS, contract.N_COLS)}, "
                f"got {climatology.shape}"
            )
        climatology = np.where(
            mask[None, :, :], climatology, np.nan
        ).astype(np.float32)
        _write_binary(
            out_dir / "series" / "climatology" / f"{variable_id}.f32",
            climatology,
            FLOAT_DTYPE,
        )


def export_tiles(
    anomaly_dir: Path,
    out_dir: Path,
    variable_ids: Sequence[str],
    mask: np.ndarray,
    months: Sequence[str],
) -> list[str]:
    """Write only the schema 1.1 anomaly tiles (no per-cell values tiles)."""
    tiles = tiles_with_mask(mask)
    for variable_id in variable_ids:
        anomalies_path = anomaly_dir / f"{variable_id}.nc"
        if not anomalies_path.is_file():
            raise FileNotFoundError(f"P02 anomaly cube missing: {anomalies_path}")
        with xr.open_dataset(anomalies_path, engine="netcdf4") as ds:
            anomalies = _load_monthly(
                ds, "anomaly", f"{variable_id} anomalies", months
            )

        for tile_id, row, col in tiles:
            tile_mask = mask[
                row : row + contract.TILE_SIZE,
                col : col + contract.TILE_SIZE,
            ]
            tile_anomalies = anomalies[
                :, row : row + contract.TILE_SIZE, col : col + contract.TILE_SIZE
            ].copy()
            tile_anomalies[:, ~tile_mask] = np.nan
            _write_binary(
                out_dir / "series" / "tiles" / variable_id
                / f"{tile_id}.anomalies.f32",
                tile_anomalies,
                FLOAT_DTYPE,
            )
    return [tile_id for tile_id, _, _ in tiles]


def build_index(
    registry: dict,
    variable_ids: Sequence[str],
    window_ids: Sequence[str],
    correlation_pairs: Sequence[str],
    tile_ids: Sequence[str],
    generated_at: str | None = None,
    quality_info: dict | None = None,
    witness_info: dict | None = None,
) -> dict:
    products = registry.get("products", {})
    variables = verified_variables(registry, variable_ids)
    index = {
        "schema_version": EXPORT_SCHEMA_VERSION,
        "generated_at": generated_at or _timestamp(),
        "synthetic": False,
        "grid": {
            "resolution_deg": contract.RESOLUTION_DEG,
            "n_rows": contract.N_ROWS,
            "n_cols": contract.N_COLS,
            "lat_north_center": contract.LAT_NORTH_CENTER,
            "lon_west_center": contract.LON_WEST_CENTER,
        },
        "months": month_labels(),
        "baseline": list(contract.BASELINE),
        "windows": [
            {
                "id": window_id,
                "start": contract.WINDOWS[window_id][0],
                "end": contract.WINDOWS[window_id][1],
            }
            for window_id in window_ids
        ],
        "q_threshold": contract.Q_THRESHOLD,
        "variables": [
            _index_variable(variable, products) for variable in variables
        ],
        "pattern_pair": dict(PATTERN_PAIR),
        "correlation_pairs": sorted(correlation_pairs),
        "layers": {
            "float": list(contract.FLOAT_LAYERS),
            "class": list(contract.CLASS_LAYERS),
        },
        "tiles": {
            "size": contract.TILE_SIZE,
            "ids": sorted(tile_ids),
        },
    }
    if quality_info is not None:
        index["quality"] = quality_info
    if witness_info is not None:
        index["witness"] = witness_info
    return index


def _guard_output_dir(out_dir: Path) -> None:
    resolved = out_dir.resolve()
    forbidden = WEB_DATA_DIR.resolve()
    if resolved == forbidden or forbidden in resolved.parents:
        raise ValueError(
            f"refusing to export directly into {forbidden}; use --publish after "
            "validation instead"
        )


def _validate_window_ids(window_ids: Sequence[str] | None) -> list[str]:
    if window_ids is None:
        return list(contract.WINDOWS)
    windows = list(dict.fromkeys(window_ids))
    unknown = [window_id for window_id in windows if window_id not in contract.WINDOWS]
    if unknown:
        raise KeyError(f"unknown window ids: {unknown}")
    return windows


def _select_regions(
    regions: Sequence[dict], region_ids: Sequence[str] | None
) -> list[dict]:
    if region_ids is None:
        return list(regions)
    by_id = {region["id"]: region for region in regions}
    missing = [region_id for region_id in region_ids if region_id not in by_id]
    if missing:
        raise KeyError(f"unknown region ids: {missing}")
    return [by_id[region_id] for region_id in region_ids]


# ---------------------------------------------------------------------------
# High-level export
# ---------------------------------------------------------------------------


def export_all(
    out_dir: str | Path | None = None,
    *,
    registry_path: str | Path | None = None,
    regions_path: str | Path | None = None,
    country_geojson_path: str | Path | None = None,
    interim_dir: str | Path | None = None,
    anomaly_dir: str | Path | None = None,
    trends_dir: str | Path | None = None,
    correlations_dir: str | Path | None = None,
    witness_trends_dir: str | Path | None = None,
    witness_anomaly_dir: str | Path | None = None,
    mask_path: str | Path | None = None,
    variable_ids: Sequence[str] | None = None,
    window_ids: Sequence[str] | None = None,
    region_ids: Sequence[str] | None = None,
    correlation_pairs: Sequence[str] | None = None,
    generated_at: str | None = None,
) -> dict:
    """Export a complete contract tree and return a summary dictionary."""
    start = time.perf_counter()
    output = Path(out_dir) if out_dir is not None else EXPORT_DIR
    _guard_output_dir(output)
    interim = Path(interim_dir) if interim_dir is not None else INTERIM_DIR
    anomalies = Path(anomaly_dir) if anomaly_dir is not None else ANOMALY_DIR
    trends = Path(trends_dir) if trends_dir is not None else TRENDS_DIR
    correlations = (
        Path(correlations_dir) if correlations_dir is not None else CORRELATIONS_DIR
    )
    witness_trends = (
        Path(witness_trends_dir)
        if witness_trends_dir is not None
        else WITNESS_TRENDS_DIR
    )
    witness_anomalies = (
        Path(witness_anomaly_dir)
        if witness_anomaly_dir is not None
        else WITNESS_ANOMALY_DIR
    )

    registry = load_registry(registry_path)
    regions = _select_regions(load_regions(regions_path), region_ids)
    variables = verified_variables(registry, variable_ids)
    variable_ids = [variable["id"] for variable in variables]
    windows = _validate_window_ids(window_ids)

    missing_pattern = [
        variable_id
        for variable_id in PATTERN_PAIR.values()
        if variable_id not in variable_ids
    ]
    if missing_pattern:
        raise ValueError(
            "the contract requires the pattern pair variables in the export: "
            f"missing {missing_pattern}"
        )

    mask_file = (
        Path(mask_path)
        if mask_path is not None
        else _resolve_mask_path(interim, anomalies)
    )
    mask = _load_common_mask(mask_file)

    if correlation_pairs is None:
        pair_ids = discover_correlation_pairs(correlations, windows)
    else:
        pair_ids = sorted(dict.fromkeys(correlation_pairs))
        for pair_id in pair_ids:
            parts = pair_id.split("__")
            if len(parts) != 2 or parts[0] >= parts[1]:
                raise ValueError(
                    f"correlation pair {pair_id!r} must join two variable ids "
                    "in alphabetical order"
                )
            for window_id in windows:
                path = correlations / pair_id / f"{window_id}.nc"
                if not path.is_file():
                    raise FileNotFoundError(
                        f"P03 correlation file missing: {path}"
                    )

    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True, exist_ok=True)

    countries_path = (
        Path(country_geojson_path)
        if country_geojson_path is not None
        else COUNTRIES_PATH
    )
    if not countries_path.is_file():
        raise FileNotFoundError(
            f"country GeoJSON missing: {countries_path}; run the P10 builder"
        )
    countries, country_grid = export_countries(countries_path, output, mask)

    cache = export_grids(trends, output, variable_ids, windows, mask)
    witness_info = export_witness(
        cache, witness_trends, output, variables, windows, mask
    )
    export_quality(cache, anomalies, output, variables, windows, mask)
    export_patterns(cache, output, windows, mask)
    export_correlations(correlations, output, pair_ids, windows, mask)
    export_screener(
        cache,
        output,
        variable_ids,
        windows,
        regions,
        mask,
        countries=countries,
        country_grid=country_grid,
    )
    months = month_labels()
    export_region_series(
        interim,
        anomalies,
        output,
        variables,
        regions,
        mask,
        months,
        countries=countries,
        country_grid=country_grid,
        witness_anomaly_dir=witness_anomalies,
    )
    export_climatology(anomalies, output, variable_ids, mask)
    tile_ids = export_tiles(
        anomalies, output, variable_ids, mask, months
    )

    quality_info = {
        "method": (
            "Pettitt test (BH-FDR q < 0.05) on annual-mean anomalies + "
            "step-vs-linear delta BIC >= 2"
        ),
        "layers": list(contract.QUALITY_LAYERS),
        "known_forcing_changes": {
            product: list(range_values)
            for product, range_values in contract.KNOWN_FORCING_CHANGES.items()
        },
    }
    _write_json(
        output / "index.json",
        build_index(
            registry,
            variable_ids,
            windows,
            pair_ids,
            tile_ids,
            generated_at=generated_at,
            quality_info=quality_info,
            witness_info=witness_info,
        ),
    )
    _write_json(
        output / "regions.json",
        {
            "regions": [{**region, "kind": "box"} for region in regions],
            "countries": countries,
            "country_grid": contract.COUNTRY_GRID_FILE,
        },
    )
    _write_json(
        output / "cases.json",
        {
            "synthetic": False,
            "selection_method": "pending (P06)",
            "cases": [],
        },
    )

    files = [path for path in output.rglob("*") if path.is_file()]
    return {
        "out_dir": str(output),
        "variables": variable_ids,
        "windows": windows,
        "regions": [region["id"] for region in regions],
        "countries": [country["id"] for country in countries],
        "correlation_pairs": pair_ids,
        "tiles": len(tile_ids),
        "files": len(files),
        "bytes": sum(path.stat().st_size for path in files),
        "elapsed_seconds": time.perf_counter() - start,
        "mask_cells": int(mask.sum()),
    }


# ---------------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------------


def _read_json(path: Path, errors: list[str]) -> object | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - collect, do not crash the validator
        errors.append(f"{path.name}: cannot read JSON: {exc}")
        return None


def _check_keys(
    obj: object,
    required: set[str],
    label: str,
    errors: list[str],
    optional: set[str] | None = None,
) -> bool:
    if not isinstance(obj, dict):
        errors.append(f"{label}: expected a JSON object")
        return False
    optional = optional or set()
    keys = set(obj)
    missing = sorted(required - keys)
    extra = sorted(keys - required - optional)
    if missing:
        errors.append(f"{label}: missing keys {missing}")
    if extra:
        errors.append(f"{label}: unexpected keys {extra}")
    return not missing and not extra


def _check_file(
    folder: Path, relative: str, expected_bytes: int | None, errors: list[str]
) -> Path | None:
    path = folder / relative
    if not path.is_file():
        errors.append(f"missing file: {relative}")
        return None
    if expected_bytes is not None:
        size = path.stat().st_size
        if size != expected_bytes:
            errors.append(
                f"{relative}: size {size} bytes, expected {expected_bytes}"
            )
    return path


def _read_class(path: Path, expected_code_count: int, errors: list[str]) -> np.ndarray | None:
    if not path.is_file():
        return None
    values = np.fromfile(path, dtype=np.int8)
    if values.size != expected_code_count:
        errors.append(
            f"{path.name}: {values.size} class values, expected {expected_code_count}"
        )
        return None
    return values


def _read_float(path: Path, errors: list[str]) -> np.ndarray | None:
    if not path.is_file():
        return None
    values = np.fromfile(path, dtype="<f4")
    if values.size != GRID_VALUE_COUNT:
        errors.append(
            f"{path.name}: {values.size} float values, expected {GRID_VALUE_COUNT}"
        )
        return None
    return values


def validate_export(folder: str | Path, release: bool = False) -> dict:
    """Validate a contract data folder.

    Returns ``{"ok": bool, "errors": [...], "files": int, "bytes": int,
    "synthetic": bool, "synthetic_files": [...]}``. ``release=True`` fails when
    any JSON still carries ``"synthetic": true``.
    """
    root = Path(folder)
    errors: list[str] = []
    files = [path for path in root.rglob("*") if path.is_file()] if root.is_dir() else []
    total_bytes = sum(path.stat().st_size for path in files)

    synthetic_files: list[str] = []
    for path in files:
        if path.suffix.lower() != ".json":
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 - index reader reports the detail
            continue
        if isinstance(data, dict) and data.get("synthetic") is True:
            synthetic_files.append(str(path.relative_to(root)))

    if not root.is_dir():
        errors.append(f"folder does not exist: {root}")
        return {
            "ok": False,
            "errors": errors,
            "files": 0,
            "bytes": 0,
            "synthetic": bool(synthetic_files),
            "synthetic_files": synthetic_files,
            "schema_version": None,
        }

    index_path = root / "index.json"
    if not index_path.is_file():
        errors.append("missing file: index.json")
        return {
            "ok": False,
            "errors": errors,
            "files": len(files),
            "bytes": total_bytes,
            "synthetic": bool(synthetic_files),
            "synthetic_files": synthetic_files,
            "schema_version": None,
        }

    index = _read_json(index_path, errors)
    if not isinstance(index, dict):
        return {
            "ok": False,
            "errors": errors,
            "files": len(files),
            "bytes": total_bytes,
            "synthetic": bool(synthetic_files),
            "synthetic_files": synthetic_files,
            "schema_version": None,
        }

    if not _check_keys(
        index, INDEX_KEYS, "index.json", errors, optional=INDEX_OPTIONAL_KEYS
    ):
        # Continue with whatever is present; missing references are reported below.
        pass

    if index.get("schema_version") != EXPORT_SCHEMA_VERSION:
        errors.append(
            f"index.json: schema_version {index.get('schema_version')!r} "
            f"!= {EXPORT_SCHEMA_VERSION!r}"
        )
    expected_grid = {
        "resolution_deg": contract.RESOLUTION_DEG,
        "n_rows": contract.N_ROWS,
        "n_cols": contract.N_COLS,
        "lat_north_center": contract.LAT_NORTH_CENTER,
        "lon_west_center": contract.LON_WEST_CENTER,
    }
    if index.get("grid") != expected_grid:
        errors.append("index.json: grid does not match the contract")
    expected_months = month_labels()
    if index.get("months") != expected_months:
        errors.append("index.json: months do not match the contract")
    if index.get("baseline") != list(contract.BASELINE):
        errors.append("index.json: baseline does not match the contract")
    if index.get("q_threshold") != contract.Q_THRESHOLD:
        errors.append("index.json: q_threshold does not match the contract")

    variables_obj = index.get("variables", [])
    if not isinstance(variables_obj, list):
        errors.append("index.json: variables must be a list")
        variables_obj = []
    variable_ids: list[str] = []
    for entry in variables_obj:
        if _check_keys(entry, VARIABLE_KEYS, "index.json variable", errors):
            variable_id = entry["id"]
            if variable_id in variable_ids:
                errors.append(f"index.json: duplicate variable {variable_id!r}")
            variable_ids.append(variable_id)
            if entry.get("slope_unit") != f"{entry.get('display_unit')} per year":
                errors.append(
                    f"index.json variable {variable_id!r}: slope_unit does not "
                    "follow the display unit"
                )

    windows_obj = index.get("windows", [])
    if not isinstance(windows_obj, list):
        errors.append("index.json: windows must be a list")
        windows_obj = []
    window_ids: list[str] = []
    for entry in windows_obj:
        if not _check_keys(entry, {"id", "start", "end"}, "index.json window", errors):
            continue
        window_id = entry["id"]
        if window_id not in contract.WINDOWS:
            errors.append(f"index.json: unknown window {window_id!r}")
            continue
        start, end = contract.WINDOWS[window_id]
        if entry["start"] != start or entry["end"] != end:
            errors.append(
                f"index.json: window {window_id!r} start/end do not match contract"
            )
        window_ids.append(window_id)
    if not window_ids:
        errors.append("index.json: no windows listed")

    pattern_pair = index.get("pattern_pair", {})
    if not _check_keys(
        pattern_pair,
        {"temperature", "moisture"},
        "index.json pattern_pair",
        errors,
    ):
        pattern_pair = {}

    layers = index.get("layers", {})
    if not _check_keys(
        layers, {"float", "class"}, "index.json layers", errors
    ):
        layers = {}
    float_layers = list(layers.get("float", []))
    class_layers = list(layers.get("class", []))
    if float_layers != list(contract.FLOAT_LAYERS):
        errors.append("index.json: layers.float does not match the contract")
    if class_layers != list(contract.CLASS_LAYERS):
        errors.append("index.json: layers.class does not match the contract")

    quality_obj = index.get("quality")
    quality_present = quality_obj is not None
    if quality_present:
        if _check_keys(
            quality_obj,
            {"method", "layers", "known_forcing_changes"},
            "index.json quality",
            errors,
        ):
            if quality_obj["layers"] != list(contract.QUALITY_LAYERS):
                errors.append("index.json: quality.layers do not match the contract")
            method = quality_obj["method"]
            if not isinstance(method, str) or "Pettitt" not in method:
                errors.append("index.json: quality.method must describe Pettitt/BIC")
            if not isinstance(quality_obj["known_forcing_changes"], dict):
                errors.append(
                    "index.json: quality.known_forcing_changes must be an object"
                )

    witness_obj = index.get("witness")
    witness_present = witness_obj is not None
    if witness_present:
        if _check_keys(
            witness_obj,
            {"method", "layers", "products"},
            "index.json witness",
            errors,
        ):
            if witness_obj["layers"] != list(contract.WITNESS_LAYERS):
                errors.append(
                    "index.json: witness.layers do not match the contract"
                )
            method = witness_obj["method"]
            if not isinstance(method, str) or "Sen" not in method:
                errors.append(
                    "index.json: witness.method must describe the trend test"
                )
            products = witness_obj["products"]
            if not isinstance(products, dict):
                errors.append(
                    "index.json: witness.products must be an object"
                )
            else:
                missing = sorted(set(variable_ids) - set(products))
                if missing:
                    errors.append(
                        f"index.json: witness.products missing variables {missing}"
                    )
                unknown = sorted(set(products) - set(variable_ids))
                if unknown:
                    errors.append(
                        f"index.json: witness.products has unknown variables {unknown}"
                    )
                for variable_id, entry in products.items():
                    if not _check_keys(
                        entry,
                        WITNESS_PRODUCT_KEYS,
                        f"index.json witness product {variable_id}",
                        errors,
                    ):
                        continue
                    expected = contract.WITNESSES.get(variable_id)
                    if expected is None:
                        continue
                    product, version, source_variable = expected
                    if (
                        entry["product"] != product
                        or entry["version"] != version
                        or entry["source_variable"] != source_variable
                    ):
                        errors.append(
                            f"index.json witness product {variable_id!r} "
                            "does not match contract.WITNESSES"
                        )

    correlation_pairs = index.get("correlation_pairs", [])
    if not isinstance(correlation_pairs, list) or not all(
        isinstance(pair, str) for pair in correlation_pairs
    ):
        errors.append("index.json: correlation_pairs must be a list of strings")
        correlation_pairs = []

    tiles_obj = index.get("tiles", {})
    if not _check_keys(
        tiles_obj, {"size", "ids"}, "index.json tiles", errors
    ):
        tiles_obj = {}
    if tiles_obj.get("size") != contract.TILE_SIZE:
        errors.append("index.json: tiles.size does not match the contract")
    tile_ids = tiles_obj.get("ids", [])
    if not isinstance(tile_ids, list) or not all(isinstance(t, str) for t in tile_ids):
        errors.append("index.json: tiles.ids must be a list of strings")
        tile_ids = []
    for tile_id in tile_ids:
        match = re.fullmatch(r"r(\d{3})_c(\d{3})", tile_id)
        if not match:
            errors.append(f"index.json: invalid tile id {tile_id!r}")
            continue
        row, col = int(match.group(1)), int(match.group(2))
        if row % contract.TILE_SIZE or col % contract.TILE_SIZE:
            errors.append(f"index.json: tile id {tile_id!r} is not on a tile edge")
        if row + contract.TILE_SIZE > contract.N_ROWS or col + contract.TILE_SIZE > contract.N_COLS:
            errors.append(f"index.json: tile id {tile_id!r} is outside the grid")

    # regions.json
    regions_path = root / "regions.json"
    region_ids: list[str] = []
    country_ids: list[str] = []
    country_entries: list[dict] = []
    country_grid_rel: str | None = None
    regions_obj = _read_json(regions_path, errors)
    if regions_obj is None:
        errors.append("missing file: regions.json")
    elif _check_keys(
        regions_obj,
        REGIONS_FILE_KEYS,
        "regions.json",
        errors,
        optional=REGIONS_FILE_OPTIONAL_KEYS,
    ):
        regions = regions_obj["regions"]
        if not isinstance(regions, list):
            errors.append("regions.json: regions must be a list")
        else:
            for region in regions:
                if not _check_keys(
                    region,
                    {"id", "label", "bbox"},
                    "regions.json region",
                    errors,
                    optional={"kind"},
                ):
                    continue
                bbox = region["bbox"]
                if not isinstance(bbox, list) or len(bbox) != 4:
                    errors.append(
                        f"regions.json: region {region['id']!r} has an invalid bbox"
                    )
                region_ids.append(region["id"])
            if len(region_ids) != len(set(region_ids)):
                errors.append("regions.json: duplicate region ids")

        countries = regions_obj.get("countries", [])
        if countries is not None and not isinstance(countries, list):
            errors.append("regions.json: countries must be a list")
            countries = []
        for country in countries:
            if not _check_keys(country, COUNTRY_KEYS, "regions.json country", errors):
                continue
            bbox = country["bbox"]
            if not isinstance(bbox, list) or len(bbox) != 4:
                errors.append(
                    f"regions.json: country {country['id']!r} has an invalid bbox"
                )
            if not isinstance(country["index"], int):
                errors.append(
                    f"regions.json: country {country['id']!r} index must be an int"
                )
            if not isinstance(country["n_cells"], int) or country["n_cells"] < contract.COUNTRY_MIN_CELLS:
                errors.append(
                    f"regions.json: country {country['id']!r} has n_cells below "
                    f"{contract.COUNTRY_MIN_CELLS}"
                )
            country_ids.append(country["id"])
            country_entries.append(country)
        if countries:
            if not isinstance(regions_obj.get("country_grid"), str):
                errors.append("regions.json: country_grid is required with countries")
            else:
                country_grid_rel = regions_obj["country_grid"]
        if len(country_ids) != len(set(country_ids)):
            errors.append("regions.json: duplicate country ids")
        all_domain_ids = [*region_ids, *country_ids]
        if len(all_domain_ids) != len(set(all_domain_ids)):
            errors.append("regions.json: region/country ids are not unique")

    if country_grid_rel is not None:
        grid_path = _check_file(
            root,
            country_grid_rel,
            GRID_VALUE_COUNT * 2,
            errors,
        )
        if grid_path is not None:
            grid_values = np.fromfile(grid_path, dtype="<i2")
            if grid_values.size != GRID_VALUE_COUNT:
                errors.append(
                    f"{country_grid_rel}: {grid_values.size} int16 values, "
                    f"expected {GRID_VALUE_COUNT}"
                )
            else:
                allowed = {-1, *[country["index"] for country in country_entries]}
                bad = sorted(
                    set(int(value) for value in np.unique(grid_values)) - allowed
                )
                if bad:
                    errors.append(
                        f"{country_grid_rel}: unknown country indices {bad}"
                    )

    # Referenced grid files.
    grid_float_bytes = GRID_VALUE_COUNT * 4
    grid_class_bytes = GRID_VALUE_COUNT
    for variable_id in variable_ids:
        for window_id in window_ids:
            for layer in float_layers:
                _check_file(
                    root,
                    f"grids/{variable_id}/{window_id}/{layer}.f32",
                    grid_float_bytes,
                    errors,
                )
            _check_file(
                root,
                f"grids/{variable_id}/{window_id}/trend_class.i8",
                grid_class_bytes,
                errors,
            )

    if quality_present:
        for variable_id in variable_ids:
            for window_id in window_ids:
                flag_rel = f"grids/{variable_id}/{window_id}/quality_flag.i8"
                flag_path = _check_file(root, flag_rel, grid_class_bytes, errors)
                _check_file(
                    root,
                    f"grids/{variable_id}/{window_id}/breakpoint_year.f32",
                    grid_float_bytes,
                    errors,
                )
                if flag_path is not None:
                    flags = _read_class(flag_path, GRID_VALUE_COUNT, errors)
                    if flags is not None:
                        bad = sorted(
                            set(int(code) for code in np.unique(flags))
                            - QUALITY_CLASS_CODES
                        )
                        if bad:
                            errors.append(f"{flag_rel}: illegal quality codes {bad}")

    if witness_present:
        for variable_id in variable_ids:
            for window_id in window_ids:
                agreement_rel = (
                    f"grids/{variable_id}/{window_id}/witness_agreement.i8"
                )
                agreement_path = _check_file(
                    root, agreement_rel, grid_class_bytes, errors
                )
                std_rel = (
                    f"grids/{variable_id}/{window_id}/witness_std_change.f32"
                )
                std_path = _check_file(root, std_rel, grid_float_bytes, errors)
                if agreement_path is not None:
                    agreement = _read_class(
                        agreement_path, GRID_VALUE_COUNT, errors
                    )
                    if agreement is not None:
                        bad = sorted(
                            set(int(code) for code in np.unique(agreement))
                            - WITNESS_AGREEMENT_CODES
                        )
                        if bad:
                            errors.append(
                                f"{agreement_rel}: illegal witness codes {bad}"
                            )
                        if std_path is not None:
                            std = _read_float(std_path, errors)
                            if std is not None:
                                invalid = np.isin(
                                    agreement,
                                    (
                                        contract.INSUFFICIENT_DATA,
                                        contract.OUTSIDE_DOMAIN,
                                    ),
                                )
                                if np.any(~np.isnan(std[invalid])):
                                    errors.append(
                                        f"{std_rel}: NaN required where "
                                        "witness_agreement is -9 or -99"
                                    )

    for window_id in window_ids:
        pattern_path = _check_file(
            root,
            f"patterns/{window_id}/pattern_class.i8",
            grid_class_bytes,
            errors,
        )
        if pattern_path is not None:
            classes = _read_class(pattern_path, GRID_VALUE_COUNT, errors)
            if classes is not None:
                bad = sorted(set(int(code) for code in np.unique(classes)) - PATTERN_CLASS_CODES)
                if bad:
                    errors.append(
                        f"patterns/{window_id}/pattern_class.i8: illegal codes {bad}"
                    )

    for pair_id in correlation_pairs:
        for window_id in window_ids:
            for layer in contract.CORRELATION_LAYERS:
                _check_file(
                    root,
                    f"correlations/{pair_id}/{window_id}/{layer}.f32",
                    grid_float_bytes,
                    errors,
                )

    # Screener files.
    domains = ["global", *region_ids, *country_ids]
    for window_id in window_ids:
        for domain_id in domains:
            relative = f"screener/{window_id}/{domain_id}.json"
            path = root / relative
            if not path.is_file():
                errors.append(f"missing file: {relative}")
                continue
            data = _read_json(path, errors)
            if not _check_keys(data, SCREENER_KEYS, relative, errors):
                continue
            if data["window"] != window_id or data["domain"] != domain_id:
                errors.append(f"{relative}: window/domain do not match the path")
            rows = data["rows"]
            if not isinstance(rows, list):
                errors.append(f"{relative}: rows must be a list")
                continue
            seen: list[str] = []
            for row in rows:
                if not _check_keys(
                    row,
                    SCREENER_ROW_KEYS,
                    f"{relative} row",
                    errors,
                    optional=SCREENER_ROW_OPTIONAL_KEYS,
                ):
                    continue
                seen.append(row["variable"])
                if "step_flag_area_fraction" in row:
                    value = row["step_flag_area_fraction"]
                    if value is not None and not isinstance(value, (int, float)):
                        errors.append(
                            f"{relative}: step_flag_area_fraction must be numeric or null"
                        )
                if "sig_trend_flagged_fraction" in row:
                    value = row["sig_trend_flagged_fraction"]
                    if value is not None and not isinstance(value, (int, float)):
                        errors.append(
                            f"{relative}: sig_trend_flagged_fraction must be numeric or null"
                        )
                for field in (
                    "witness_corroborated_fraction",
                    "witness_contradicted_fraction",
                ):
                    if witness_present and field not in row:
                        errors.append(f"{relative}: missing {field}")
                        continue
                    if field in row:
                        value = row[field]
                        if value is not None and not isinstance(
                            value, (int, float)
                        ):
                            errors.append(
                                f"{relative}: {field} must be numeric or null"
                            )
            if len(seen) != len(set(seen)):
                errors.append(f"{relative}: duplicate variable rows")
            if set(seen) != set(variable_ids):
                errors.append(
                    f"{relative}: rows cover {sorted(set(seen))}, "
                    f"expected {sorted(variable_ids)}"
                )

    # Region series.
    for region_id in [*region_ids, *country_ids]:
        for variable_id in variable_ids:
            relative = f"series/regions/{region_id}/{variable_id}.json"
            path = root / relative
            if not path.is_file():
                errors.append(f"missing file: {relative}")
                continue
            data = _read_json(path, errors)
            if not _check_keys(
                data,
                REGION_SERIES_KEYS,
                relative,
                errors,
                optional=REGION_SERIES_OPTIONAL_KEYS,
            ):
                continue
            if data["region"] != region_id or data["variable"] != variable_id:
                errors.append(f"{relative}: region/variable do not match the path")
            if data["months"] != expected_months:
                errors.append(f"{relative}: months do not match index.json")
            for field in ("months", "values", "anomalies", "valid_cell_fraction"):
                if not isinstance(data[field], list):
                    errors.append(f"{relative}: {field} must be a list")
                elif len(data[field]) != len(expected_months):
                    errors.append(
                        f"{relative}: {field} has {len(data[field])} entries, "
                        f"expected {len(expected_months)}"
                    )
            if witness_present and "witness_anomalies" not in data:
                errors.append(f"{relative}: missing witness_anomalies")
            if "witness_anomalies" in data:
                if not isinstance(data["witness_anomalies"], list):
                    errors.append(
                        f"{relative}: witness_anomalies must be a list"
                    )
                elif len(data["witness_anomalies"]) != len(expected_months):
                    errors.append(
                        f"{relative}: witness_anomalies has "
                        f"{len(data['witness_anomalies'])} entries, "
                        f"expected {len(expected_months)}"
                    )
            if witness_present and "witness_unit" not in data:
                errors.append(f"{relative}: missing witness_unit")
            if "witness_unit" in data and not isinstance(
                data["witness_unit"], str
            ):
                errors.append(f"{relative}: witness_unit must be a string")

    # Climatology is a schema 1.1 file: one [12, 180, 360] layer per variable.
    climatology_bytes = CLIMATOLOGY_VALUE_COUNT * 4
    for variable_id in variable_ids:
        _check_file(
            root,
            f"series/climatology/{variable_id}.f32",
            climatology_bytes,
            errors,
        )

    # Tiles. Schema 1.1 stores anomalies only; values are reconstructed in the UI.
    tile_bytes = TILE_VALUE_COUNT * 4
    for tile_id in tile_ids:
        for variable_id in variable_ids:
            _check_file(
                root,
                f"series/tiles/{variable_id}/{tile_id}.anomalies.f32",
                tile_bytes,
                errors,
            )

    # Trend-class/q-value consistency and "outside domain is NaN".
    for variable_id in variable_ids:
        for window_id in window_ids:
            class_rel = f"grids/{variable_id}/{window_id}/trend_class.i8"
            q_rel = f"grids/{variable_id}/{window_id}/q_value.f32"
            class_path = root / class_rel
            q_path = root / q_rel
            if not class_path.is_file() or not q_path.is_file():
                continue
            classes = _read_class(class_path, GRID_VALUE_COUNT, errors)
            q_values = _read_float(q_path, errors)
            if classes is None or q_values is None:
                continue
            if classes.size != GRID_VALUE_COUNT or q_values.size != GRID_VALUE_COUNT:
                continue
            classes = classes.reshape(contract.N_ROWS, contract.N_COLS)
            q_values = q_values.reshape(contract.N_ROWS, contract.N_COLS)
            bad_codes = sorted(
                set(int(code) for code in np.unique(classes)) - TREND_CLASS_CODES
            )
            if bad_codes:
                errors.append(f"{class_rel}: illegal class codes {bad_codes}")

            outside = classes == contract.OUTSIDE_DOMAIN
            if np.any(~np.isnan(q_values[outside])):
                errors.append(
                    f"{q_rel}: q_value must be NaN outside the domain"
                )
            insufficient = classes == contract.INSUFFICIENT_DATA
            if np.any(~np.isnan(q_values[insufficient])):
                errors.append(
                    f"{q_rel}: q_value must be NaN for insufficient-data cells"
                )
            significant = np.isin(
                classes, (contract.TREND_INCREASE, contract.TREND_DECREASE)
            )
            if np.any(~np.isfinite(q_values[significant])):
                errors.append(
                    f"{q_rel}: significant cells need a finite q_value"
                )
            if np.any(q_values[significant] >= contract.Q_THRESHOLD):
                errors.append(
                    f"{q_rel}: significant cells have q_value >= "
                    f"{contract.Q_THRESHOLD}"
                )

            for layer in float_layers:
                layer_path = root / f"grids/{variable_id}/{window_id}/{layer}.f32"
                if not layer_path.is_file():
                    continue
                values = np.fromfile(layer_path, dtype="<f4")
                if values.size != GRID_VALUE_COUNT:
                    continue
                values = values.reshape(contract.N_ROWS, contract.N_COLS)
                if np.any(~np.isnan(values[outside])):
                    errors.append(
                        f"grids/{variable_id}/{window_id}/{layer}.f32: "
                        "values must be NaN outside the domain"
                    )

    # Cases file is a placeholder until P06.
    cases_path = root / "cases.json"
    if not cases_path.is_file():
        errors.append("missing file: cases.json")
    else:
        cases = _read_json(cases_path, errors)
        _check_keys(cases, CASE_FILE_KEYS, "cases.json", errors)

    if release and synthetic_files:
        errors.append(
            f"release check failed: {len(synthetic_files)} JSON file(s) have "
            "synthetic=true"
        )

    if total_bytes > 400 * 1024 * 1024:
        errors.append(
            f"export is {total_bytes / (1024 * 1024):.1f} MB, above the 400 MB budget"
        )

    return {
        "ok": not errors,
        "errors": errors,
        "files": len(files),
        "bytes": total_bytes,
        "synthetic": bool(synthetic_files),
        "synthetic_files": synthetic_files,
        "schema_version": index.get("schema_version"),
    }


def publish_export(
    source: str | Path,
    target: str | Path | None = None,
    *,
    release: bool = True,
) -> dict:
    """Copy a validated export into ``web/public/data`` (explicit opt-in only)."""
    source_path = Path(source)
    target_path = Path(target) if target is not None else WEB_DATA_DIR
    if source_path.resolve() == target_path.resolve():
        raise ValueError("source and target are the same folder")
    result = validate_export(source_path, release=release)
    if not result["ok"]:
        raise RuntimeError(
            "refusing to publish: validation failed:\n"
            + "\n".join(f"- {error}" for error in result["errors"])
        )
    if target_path.exists():
        shutil.rmtree(target_path)
    shutil.copytree(source_path, target_path)
    return result
