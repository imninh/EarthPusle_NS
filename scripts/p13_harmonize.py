#!/usr/bin/env python
"""P13 T2: conservative regridding of the witness products to the 1° grid.

Reads the downloaded raw files, extracts the configured variables, converts
units, applies the current common mask, and writes
``data/interim/witness/{variable}.nc`` with dims ``(time, lat, lon)``.
"""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import numpy as np
import xarray as xr

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from earthpulse import contract  # noqa: E402
from earthpulse.witness import (  # noqa: E402
    apply_mask,
    area_weighted_regrid,
    build_overlap_weights,
    convert_units,
    load_witness_config,
)

RAW_ROOT = PROJECT_ROOT / "data" / "raw" / "witness"
INTERIM_DIR = PROJECT_ROOT / "data" / "interim" / "witness"
MASK_PATH = PROJECT_ROOT / "data" / "interim" / "harmonized_monthly" / "common_mask.nc"
MONTHS = [(year, month) for year in range(2001, 2025) for month in range(1, 13)]


def month_from_name(name: str) -> tuple[int, int] | None:
    match = re.search(r"\.(\d{4})(\d{2})\.nc4$", name)
    if match:
        return int(match.group(1)), int(match.group(2))
    match = re.search(r"_L3_(\d{4})(\d{2})_", name)
    if match:
        return int(match.group(1)), int(match.group(2))
    return None


def find_files(product_cfg: dict) -> dict[tuple[int, int], Path]:
    directory = RAW_ROOT / product_cfg["raw_subdir"]
    files: dict[tuple[int, int], Path] = {}
    for path in sorted(directory.glob("*")):
        if not path.is_file() or path.name.endswith(".log"):
            continue
        key = month_from_name(path.name)
        if key is not None:
            if key in files:
                raise RuntimeError(f"duplicate witness file for {key}: {path}")
            files[key] = path
    missing = [f"{y:04d}-{m:02d}" for y, m in MONTHS if (y, m) not in files]
    if missing:
        raise FileNotFoundError(
            f"{product_cfg['short_name']}: {len(missing)} missing months; first {missing[:5]}"
        )
    return files


def load_mask() -> np.ndarray:
    with xr.open_dataset(MASK_PATH, engine="netcdf4") as ds:
        return np.asarray(ds["common_mask"].values, dtype=bool)


def source_grid(path: Path, variable: str) -> tuple[np.ndarray, np.ndarray]:
    with xr.open_dataset(path, engine="netcdf4", decode_times=False) as ds:
        return (
            np.asarray(ds["lat"].values, dtype=float),
            np.asarray(ds["lon"].values, dtype=float),
        )


def read_variable(ds: xr.Dataset, name: str) -> np.ndarray:
    variable = ds[name]
    values = np.asarray(variable.values, dtype=float)
    if values.ndim == 3:
        values = values[0]
    fill = variable.attrs.get("_FillValue", variable.attrs.get("missing_value"))
    if fill is not None:
        values[values == float(fill)] = np.nan
    values[~np.isfinite(values)] = np.nan
    return values


def harmonize_product(product_name: str, product_cfg: dict, variables: dict,
                      mask: np.ndarray) -> dict[str, np.ndarray]:
    files = find_files(product_cfg)
    first_path = files[MONTHS[0]]
    lat, lon = source_grid(first_path, "lat")
    print(f"\n=== {product_name} ===\n  building overlap weights for {lat.size}x{lon.size}",
          flush=True)
    started = time.perf_counter()
    weights = build_overlap_weights(lat, lon)
    print(f"  weights: {weights.nnz} overlaps in {time.perf_counter()-started:.1f}s",
          flush=True)

    output = {
        variable_id: np.full((len(MONTHS), contract.N_ROWS, contract.N_COLS), np.nan,
                             dtype=np.float32)
        for variable_id, cfg in variables.items()
        if cfg["product"] == product_name
    }
    for index, (year, month) in enumerate(MONTHS):
        path = files[(year, month)]
        with xr.open_dataset(path, engine="netcdf4", decode_times=False,
                             mask_and_scale=False) as ds:
            for variable_id, cfg in variables.items():
                if cfg["product"] != product_name:
                    continue
                values = read_variable(ds, cfg["source_variable"])
                values = convert_units(values, cfg["conversion"], year, month)
                regridded = area_weighted_regrid(values, weights, values.shape)
                output[variable_id][index] = apply_mask(regridded, mask)
        if (index + 1) % 24 == 0 or index == 0:
            print(f"  {year}-{month:02d}: {index + 1}/{len(MONTHS)}", flush=True)
    return output


def write_variable(variable_id: str, values: np.ndarray, cfg: dict,
                   product_cfg: dict) -> None:
    time = np.array([np.datetime64(f"{y:04d}-{m:02d}", "M") for y, m in MONTHS])
    lat = contract.LAT_NORTH_CENTER - np.arange(contract.N_ROWS) * contract.RESOLUTION_DEG
    lon = contract.LON_WEST_CENTER + np.arange(contract.N_COLS) * contract.RESOLUTION_DEG
    ds = xr.Dataset(
        {
            variable_id: xr.DataArray(
                values,
                dims=("time", "lat", "lon"),
                coords={"time": time, "lat": lat, "lon": lon},
                attrs={"units": cfg["display_unit"]},
            )
        },
        attrs={
            "title": f"P13 witness: {variable_id}",
            "units": cfg["display_unit"],
            "source_product": product_cfg["short_name"],
            "source_version": str(product_cfg["version"]),
            "source_variable": cfg["source_variable"],
            "native_unit": cfg["native_unit"],
            "conversion": cfg["conversion"],
            "doi": product_cfg["doi"],
            "independence": product_cfg["independence"],
            "grid": "contract 180x360, row 0 north",
            "mask": "current common mask applied; outside is NaN",
            "package": "P13",
        },
    )
    path = INTERIM_DIR / f"{variable_id}.nc"
    path.parent.mkdir(parents=True, exist_ok=True)
    ds.to_netcdf(
        path,
        engine="netcdf4",
        encoding={variable_id: {"dtype": "float32", "zlib": True, "complevel": 4}},
    )
    ds.close()
    print(f"  wrote {path}", flush=True)


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--product",
        action="append",
        default=None,
        help="product short name to harmonize (default: all in config)",
    )
    args = parser.parse_args()
    config = load_witness_config()
    products = config["products"]
    requested = args.product or list(products)
    unknown = [name for name in requested if name not in products]
    if unknown:
        print(f"Unknown product(s): {unknown}", file=sys.stderr)
        return 2

    mask = load_mask()
    print(f"common mask: {int(mask.sum())} cells", flush=True)
    INTERIM_DIR.mkdir(parents=True, exist_ok=True)
    for product_name in requested:
        output = harmonize_product(product_name, products[product_name],
                                   config["variables"], mask)
        for variable_id, values in output.items():
            write_variable(variable_id, values, config["variables"][variable_id],
                           products[product_name])
    summary = {
        "variables": sorted(
            str(path.stem) for path in INTERIM_DIR.glob("*.nc")
        ),
        "mask_cells": int(mask.sum()),
        "months": len(MONTHS),
    }
    (INTERIM_DIR / "harmonize_summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    print(f"RESULT: OK ({len(summary['variables'])} witness cubes)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
