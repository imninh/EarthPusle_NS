#!/usr/bin/env python
"""P24 T1 probe: list every field already on disk, with file attributes and one-month statistics.

This script does **not** modify data. It writes ``data/interim/catalog/probe_fields.json``
and prints a compact table. Validity across months is a separate stage in the same file
(``--stage validity``).
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from typing import Any

import numpy as np
import xarray as xr

PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = PROJECT_ROOT / "data" / "interim" / "catalog"

MONTHS = [(year, month) for year in range(2001, 2025) for month in range(1, 13)]
SAMPLE_MONTHS = [
    (year, month) for year in range(2001, 2025) for month in (1, 7)
]

PRODUCTS = {
    "GLDAS_NOAH10_M": {
        "dir": PROJECT_ROOT / "data" / "raw" / "gldas",
        "glob": "GLDAS_NOAH10_M.A{year:04d}{month:02d}.021.nc4",
        "version": "2.1",
        "doi": "10.5067/LWTYSMP3VM5Z",
        "source_type": "model",
        "native_grid": "1.0 deg (150 x 360; no Antarctica)",
    },
    "M2TMNXSLV": {
        "dir": PROJECT_ROOT / "data" / "raw" / "witness" / "M2TMNXSLV",
        "glob": "MERRA2_*.tavgM_2d_slv_Nx.{year:04d}{month:02d}.nc4",
        "version": "5.12.4",
        "doi": "10.5067/AP1B0BA5PD2K",
        "source_type": "reanalysis",
        "native_grid": "0.5 deg lat x 0.625 deg lon (361 x 576)",
    },
    "M2TMNXLND": {
        "dir": PROJECT_ROOT / "data" / "raw" / "witness" / "M2TMNXLND",
        "glob": "MERRA2_*.tavgM_2d_lnd_Nx.{year:04d}{month:02d}.nc4",
        "version": "5.12.4",
        "doi": "10.5067/8S35XF81C28F",
        "source_type": "reanalysis",
        "native_grid": "0.5 deg lat x 0.625 deg lon (361 x 576)",
    },
}

PUBLISHED_SOURCE_FIELDS = {
    "AvgSurfT_inst",
    "RootMoist_inst",
    "Tair_f_inst",
    "SoilMoi0_10cm_inst",
    "Evap_tavg",
    "Qair_f_inst",
}

# P23/P24 pilot fields and their agreed labels.
PILOT = {
    "T850": ("air_temperature_850hpa", "Air temperature about 1.5 km up", "temperature", "warmer"),
    "T500": ("air_temperature_500hpa", "Air temperature about 5.5 km up", "temperature", "warmer"),
    "TQV": ("column_water_vapor", "All water vapour in the air column", "atmosphere", "more water vapour"),
    "TO3": ("total_ozone", "Total ozone in the air column", "atmosphere", "more ozone"),
}


def first_path(product: dict[str, Any], year: int = 2001, month: int = 1) -> Path:
    pattern = product["glob"].format(year=year, month=month)
    matches = sorted(product["dir"].glob(pattern))
    if not matches:
        raise FileNotFoundError(f"no file for {pattern}")
    return matches[0]


def read_values(ds: xr.Dataset, name: str) -> np.ndarray:
    variable = ds[name]
    values = np.asarray(variable.values, dtype=float)
    if values.ndim == 3:
        values = values[0]
    fill = variable.attrs.get("_FillValue", variable.attrs.get("missing_value"))
    if fill is not None:
        values[values == float(fill)] = np.nan
    valid_range = variable.attrs.get("valid_range")
    if valid_range is not None:
        low, high = float(valid_range[0]), float(valid_range[1])
        values[(values < low) | (values > high)] = np.nan
    values[~np.isfinite(values)] = np.nan
    return values


def finite_stats(values: np.ndarray) -> dict[str, float | None]:
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return {"min": None, "median": None, "max": None, "n_finite": 0}
    return {
        "min": float(np.min(finite)),
        "median": float(np.median(finite)),
        "max": float(np.max(finite)),
        "n_finite": int(finite.size),
    }


def collect_fields() -> dict[str, Any]:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                              "month": "2001-01", "products": {}, "fields": []}
    for product_name, product in PRODUCTS.items():
        path = first_path(product)
        t0 = time.perf_counter()
        with xr.open_dataset(path, engine="netcdf4", decode_times=False, mask_and_scale=False) as ds:
            lat = np.asarray(ds["lat"].values, dtype=float)
            lon = np.asarray(ds["lon"].values, dtype=float)
            report["products"][product_name] = {
                "file": path.name,
                "version": product["version"],
                "doi": product["doi"],
                "source_type": product["source_type"],
                "native_grid": product["native_grid"],
                "n_lat": int(lat.size),
                "n_lon": int(lon.size),
                "lat_first": float(lat[0]),
                "lat_last": float(lat[-1]),
                "lon_first": float(lon[0]),
                "lon_last": float(lon[-1]),
            }
            for name in ds.variables:
                variable = ds[name]
                if name in ds.coords or "time" not in variable.dims:
                    continue
                if variable.ndim != 3 or variable.shape[1:] != (lat.size, lon.size):
                    continue
                values = read_values(ds, name)
                stats = finite_stats(values)
                reason = None
                if name.startswith("Var_"):
                    reason = "MERRA-2 variance field (Var_*) excluded by P24 T1."
                elif product_name == "GLDAS_NOAH10_M" and name in PUBLISHED_SOURCE_FIELDS:
                    reason = "Source field of one of the seven published variables."
                elif name in {"Qs_acc", "Qsb_acc", "Qsm_acc"}:
                    reason = "Accumulation whose monthly convention is unresolved (variables.yaml)."
                pilot = PILOT.get(name)
                report["fields"].append(
                    {
                        "product": product_name,
                        "source_variable": name,
                        "long_name": variable.attrs.get("long_name"),
                        "units": variable.attrs.get("units"),
                        "dims": list(variable.dims),
                        "shape": list(variable.shape),
                        "month": "2001-01",
                        "stats": stats,
                        "pilot_id": pilot[0] if pilot else None,
                        "pilot_description": pilot[1] if pilot else None,
                        "pilot_category": pilot[2] if pilot else None,
                        "pilot_increase_means": pilot[3] if pilot else None,
                        "excluded_reason": reason,
                    }
                )
        print(
            f"{product_name}: {len([f for f in report['fields'] if f['product'] == product_name])} fields "
            f"from {path.name} in {time.perf_counter() - t0:.1f}s",
            flush=True,
        )
    out = OUT_DIR / "probe_fields.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"wrote {out}")
    return report


# --- Validity screen -------------------------------------------------------


def nearest_indices(target: np.ndarray, source: np.ndarray) -> np.ndarray:
    """Index of the nearest source coordinate for each target coordinate."""
    index = np.searchsorted(source, target)
    index = np.clip(index, 1, source.size - 1)
    left = source[index - 1]
    right = source[index]
    choose_left = np.abs(target - left) <= np.abs(target - right)
    return np.where(choose_left, index - 1, index)


def target_coordinates() -> tuple[np.ndarray, np.ndarray]:
    lat = 89.5 - np.arange(180) * 1.0
    lon = -179.5 + np.arange(360) * 1.0
    return lat, lon


def load_mask() -> np.ndarray:
    path = PROJECT_ROOT / "data" / "interim" / "harmonized_monthly" / "common_mask.nc"
    with xr.open_dataset(path, engine="netcdf4") as ds:
        return np.asarray(ds["common_mask"].values, dtype=bool)


def validity_stage(product_name: str, fields: list[dict[str, Any]], sample: list[tuple[int, int]]) -> None:
    product = PRODUCTS[product_name]
    lat_target, lon_target = target_coordinates()
    mask = load_mask()
    path0 = first_path(product)
    with xr.open_dataset(path0, engine="netcdf4", decode_times=False, mask_and_scale=False) as ds:
        source_lat = np.asarray(ds["lat"].values, dtype=float)
        source_lon = np.asarray(ds["lon"].values, dtype=float)
    lat_order = np.argsort(source_lat)
    lon_order = np.argsort(source_lon)
    source_lat = source_lat[lat_order]
    source_lon = source_lon[lon_order]

    # GLDAS ends at 59.5 N? Read the real extent and mark target cells outside it invalid.
    lat_index = nearest_indices(lat_target, source_lat)
    lon_index = nearest_indices(lon_target, source_lon)
    outside_lat = (lat_target < source_lat.min()) | (lat_target > source_lat.max())
    outside_lon = False

    counts = {field["source_variable"]: np.zeros((180, 360), dtype=np.int16) for field in fields}
    started = time.perf_counter()
    for position, (year, month) in enumerate(sample, start=1):
        path = first_path(product, year, month)
        with xr.open_dataset(path, engine="netcdf4", decode_times=False, mask_and_scale=False) as ds:
            for field in fields:
                name = field["source_variable"]
                values = read_values(ds, name)
                values = values[np.ix_(lat_order, lon_order)]
                valid_source = np.isfinite(values)
                valid_target = valid_source[np.ix_(lat_index, lon_index)]
                if outside_lat.any():
                    valid_target[outside_lat, :] = False
                counts[name] += valid_target.astype(np.int16)
        if position % 12 == 0 or position == 1:
            print(f"  {product_name} {year}-{month:02d}: {position}/{len(sample)} "
                  f"({time.perf_counter() - started:.0f}s)", flush=True)

    mask_cells = int(mask.sum())
    threshold = int(np.ceil(0.8 * len(sample)))
    for field in fields:
        count = counts[field["source_variable"]]
        valid_cells = (count[mask] >= threshold)
        field["valid_sample_months"] = len(sample)
        field["valid_mask_share"] = float(valid_cells.sum() / mask_cells) if mask_cells else 0.0
        field["valid_mask_cells"] = int(valid_cells.sum())
        field["mask_cells"] = mask_cells
    print(f"  {product_name} validity done in {time.perf_counter() - started:.0f}s", flush=True)


def validity_all() -> None:
    source = OUT_DIR / "probe_fields.json"
    report = json.loads(source.read_text(encoding="utf-8"))
    for product_name in PRODUCTS:
        fields = [f for f in report["fields"] if f["product"] == product_name and not f["excluded_reason"]]
        print(f"{product_name}: validity for {len(fields)} candidate fields over {len(SAMPLE_MONTHS)} months")
        validity_stage(product_name, fields, SAMPLE_MONTHS)
    report["validity_sample_months"] = len(SAMPLE_MONTHS)
    report["validity_note"] = (
        "Nearest native cell sampled at each 1 deg target centre, applied to the 14,250-cell common "
        "land mask; a cell counts as valid when at least 80% of the sampled months are finite."
    )
    out = OUT_DIR / "probe_fields_with_validity.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"wrote {out}")


# --- Pilot quick-look ------------------------------------------------------


def area_weights() -> np.ndarray:
    lat = 89.5 - np.arange(180) * 1.0
    return np.cos(np.deg2rad(lat))


def pilot_stage() -> None:
    """Global-mean monthly quick-look for T850, T500, TQV and TO3, all 288 months."""
    product = PRODUCTS["M2TMNXSLV"]
    lat_target, lon_target = target_coordinates()
    mask = load_mask()
    weights = area_weights()[:, None] * np.ones((1, 360))
    weights = np.where(mask, weights, 0.0)

    path0 = first_path(product)
    with xr.open_dataset(path0, engine="netcdf4", decode_times=False, mask_and_scale=False) as ds:
        source_lat = np.asarray(ds["lat"].values, dtype=float)
        source_lon = np.asarray(ds["lon"].values, dtype=float)
    lat_order = np.argsort(source_lat)
    lon_order = np.argsort(source_lon)
    source_lat = source_lat[lat_order]
    source_lon = source_lon[lon_order]
    lat_index = nearest_indices(lat_target, source_lat)
    lon_index = nearest_indices(lon_target, source_lon)

    names = ["T850", "T500", "TQV", "TO3"]
    pressure_floor = {"T850": 85000.0, "T500": 50000.0}
    series = {name: [] for name in names}
    valid_cells = {name: [] for name in names}
    started = time.perf_counter()
    for position, (year, month) in enumerate(MONTHS, start=1):
        path = first_path(product, year, month)
        with xr.open_dataset(path, engine="netcdf4", decode_times=False, mask_and_scale=False) as ds:
            ps = read_values(ds, "PS")[np.ix_(lat_order, lon_order)]
            ps_target = ps[np.ix_(lat_index, lon_index)]
            for name in names:
                values = read_values(ds, name)[np.ix_(lat_order, lon_order)]
                target = values[np.ix_(lat_index, lon_index)]
                valid = np.isfinite(target) & mask
                if name in pressure_floor:
                    valid &= ps_target >= pressure_floor[name]
                field = np.where(valid, target, np.nan)
                valid_weights = np.where(valid, weights, 0.0)
                denominator = float(valid_weights.sum())
                mean = (
                    float(np.nansum(field * valid_weights) / denominator)
                    if denominator > 0
                    else float("nan")
                )
                series[name].append(mean)
                valid_cells[name].append(int(valid.sum()))
        if position % 24 == 0 or position == 1:
            print(f"  pilot {year}-{month:02d}: {position}/{len(MONTHS)} ({time.perf_counter() - started:.0f}s)",
                  flush=True)

    def annual(name: str) -> dict[int, float]:
        values = series[name]
        return {
            year: float(np.mean([values[(year - 2001) * 12 + month] for month in range(12)]))
            for year in range(2001, 2025)
        }

    payload = {
        "product": "M2TMNXSLV",
        "version": "5.12.4",
        "months": [f"{year:04d}-{month:02d}" for year, month in MONTHS],
        "mask_cells": int(mask.sum()),
        "method": (
            "Area-weighted global mean over the common land mask, nearest native cell per 1 degree target. "
            "T850/T500 cells with surface pressure below the level are masked (850/500 hPa)."
        ),
        "series": series,
        "valid_cells": valid_cells,
        "annual_mean": {name: annual(name) for name in names},
        "first_last": {
            name: {
                "2001": annual(name)[2001],
                "2024": annual(name)[2024],
                "change": annual(name)[2024] - annual(name)[2001],
            }
            for name in names
        },
    }
    out = OUT_DIR / "pilot_quicklook.json"
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"wrote {out}")
    for name in names:
        print(f"  {name}: 2001 {annual(name)[2001]:.4g}, 2024 {annual(name)[2024]:.4g}, "
              f"change {annual(name)[2024] - annual(name)[2001]:+.4g}, "
              f"valid cells {min(valid_cells[name])}-{max(valid_cells[name])}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", choices=["fields", "validity", "pilot", "all"], default="all")
    args = parser.parse_args()
    if args.stage in {"fields", "all"}:
        collect_fields()
    if args.stage in {"validity", "all"}:
        validity_all()
    if args.stage in {"pilot", "all"}:
        pilot_stage()


if __name__ == "__main__":
    main()
