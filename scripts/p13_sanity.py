#!/usr/bin/env python
"""P13 T5: witness sanity table, country checks and quick-look maps."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import xarray as xr  # noqa: E402
from matplotlib.colors import BoundaryNorm, ListedColormap  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from earthpulse import contract  # noqa: E402
from earthpulse.quality import pettitt_test  # noqa: E402
from earthpulse.witness import TARGET_LAT, TARGET_LON, load_witness_config  # noqa: E402

MAIN_TRENDS = PROJECT_ROOT / "data" / "processed" / "trends"
WITNESS_TRENDS = PROJECT_ROOT / "data" / "processed" / "witness" / "trends"
MAIN_ANOMALIES = PROJECT_ROOT / "data" / "processed" / "anomalies"
WITNESS_ANOMALIES = PROJECT_ROOT / "data" / "processed" / "witness" / "anomalies"
MASK_PATH = PROJECT_ROOT / "data" / "interim" / "harmonized_monthly" / "common_mask.nc"
EXPORT_DIR = PROJECT_ROOT / "data" / "export" / "web_data"
QUICKLOOK_DIR = PROJECT_ROOT / "data" / "processed" / "witness" / "quicklook"
OUT_PATH = PROJECT_ROOT / "data" / "processed" / "witness" / "sanity.json"
WINDOW = "2001-2024"

WEIGHTS = np.broadcast_to(
    np.cos(np.deg2rad(TARGET_LAT))[:, None],
    (contract.N_ROWS, contract.N_COLS),
)


def load_mask() -> np.ndarray:
    with xr.open_dataset(MASK_PATH, engine="netcdf4") as ds:
        return np.asarray(ds["common_mask"].values, dtype=bool)


def load_trend(folder: Path, variable: str, layer: str) -> np.ndarray:
    path = folder / variable / f"{WINDOW}.nc"
    with xr.open_dataset(path, engine="netcdf4") as ds:
        return np.asarray(ds[layer].values)


def area_fraction(classes: np.ndarray, domain: np.ndarray, code: int) -> float | None:
    evaluated = domain & np.isin(classes, (-1, 0, 1))
    total = float(WEIGHTS[evaluated].sum())
    if total <= 0:
        return None
    selected = evaluated & (classes == code)
    return float(WEIGHTS[selected].sum()) / total


def agreement(
    main_class: np.ndarray, witness_class: np.ndarray, domain: np.ndarray
) -> dict:
    both = domain & np.isin(main_class, (-1, 1)) & np.isin(witness_class, (-1, 1))
    n = int(both.sum())
    if n == 0:
        return {"n_cells": 0, "same_sign_fraction": None, "corroborated_fraction": None}
    same = both & (np.sign(main_class) == np.sign(witness_class))
    return {
        "n_cells": n,
        "same_sign_fraction": float(same[both].mean()),
        "corroborated_fraction": float(
            ((main_class == witness_class) & both)[both].mean()
        ),
    }


def country_masks(mask: np.ndarray) -> dict[str, np.ndarray]:
    regions_path = EXPORT_DIR / "regions.json"
    grid_path = EXPORT_DIR / contract.COUNTRY_GRID_FILE
    if not grid_path.is_file():
        raise FileNotFoundError(
            f"country grid missing: {grid_path}; publish the 1.2 export first"
        )
    regions = json.loads(regions_path.read_text(encoding="utf-8"))
    grid = np.fromfile(grid_path, dtype="<i2").reshape(contract.N_ROWS, contract.N_COLS)
    result = {}
    for country in regions.get("countries", []):
        if country["label"] in {"Vietnam", "Greenland"}:
            result[country["label"]] = mask & (grid == country["index"])
    return result


def annual_series(path: Path, variable: str, domain: np.ndarray) -> tuple[list[int], np.ndarray]:
    with xr.open_dataset(path, engine="netcdf4") as ds:
        values = np.asarray(ds["anomaly"].values, dtype=float)
        years = np.asarray(ds["time"].dt.year.values, dtype=int)
    annual = []
    year_list: list[int] = []
    for year in sorted(set(int(year) for year in years)):
        block = values[years == year]
        valid = np.isfinite(block) & domain[None, :, :]
        weight = WEIGHTS[None, :, :] * valid
        denominator = weight.sum(axis=(1, 2))
        with np.errstate(invalid="ignore", divide="ignore"):
            monthly = np.where(
                denominator > 0,
                np.nansum(np.where(valid, block, 0.0) * WEIGHTS, axis=(1, 2))
                / denominator,
                np.nan,
            )
        annual.append(float(np.nanmean(monthly)) if np.isfinite(monthly).any() else np.nan)
        year_list.append(year)
    return year_list, np.asarray(annual)


def trend_quicklook(variable: str, main_class: np.ndarray, witness_class: np.ndarray) -> Path:
    # Codes ordered [-9, -1, 1, 0, -99] are mapped manually for a readable map.
    def image(classes: np.ndarray) -> np.ndarray:
        out = np.zeros(classes.shape, dtype=int)
        out[classes == -9] = 3
        out[classes == -99] = 4
        out[classes == 0] = 0
        out[classes == 1] = 1
        out[classes == -1] = 2
        return out

    cmap = ListedColormap(["#d9d9d9", "#2166ac", "#b2182b", "#f4a582", "#f7f7f7"])
    norm = BoundaryNorm(np.arange(-0.5, 5.5, 1), cmap.N)
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5), constrained_layout=True)
    for axis, classes, title in (
        (axes[0], main_class, "Main product"),
        (axes[1], witness_class, "Witness product"),
    ):
        image_data = axis.imshow(
            image(classes),
            origin="upper",
            extent=[-180, 180, -90, 90],
            cmap=cmap,
            norm=norm,
            aspect="auto",
        )
        axis.set_title(f"{variable} — {title} trend class")
        axis.set_xlabel("Longitude")
        axis.set_ylabel("Latitude")
    QUICKLOOK_DIR.mkdir(parents=True, exist_ok=True)
    path = QUICKLOOK_DIR / f"{variable}_trend_class.png"
    fig.savefig(path, dpi=120)
    plt.close(fig)
    return path


def main() -> int:
    config = load_witness_config()
    mask = load_mask()
    countries = country_masks(mask)
    result: dict = {
        "window": WINDOW,
        "mask_cells": int(mask.sum()),
        "variables": {},
        "specific_questions": {},
        "quicklooks": [],
    }

    for variable_id in config["variables"]:
        main_class = load_trend(MAIN_TRENDS, variable_id, "trend_class")
        witness_class = load_trend(WITNESS_TRENDS, variable_id, "trend_class")
        entry = {
            "main_sig_increase": area_fraction(main_class, mask, 1),
            "main_sig_decrease": area_fraction(main_class, mask, -1),
            "witness_sig_increase": area_fraction(witness_class, mask, 1),
            "witness_sig_decrease": area_fraction(witness_class, mask, -1),
            "agreement": agreement(main_class, witness_class, mask),
            "countries": {},
        }
        for country_name, country_mask in countries.items():
            entry["countries"][country_name] = {
                "cells": int(country_mask.sum()),
                "main_sig_increase": area_fraction(main_class, country_mask, 1),
                "main_sig_decrease": area_fraction(main_class, country_mask, -1),
                "witness_sig_increase": area_fraction(witness_class, country_mask, 1),
                "witness_sig_decrease": area_fraction(witness_class, country_mask, -1),
                "agreement": agreement(main_class, witness_class, country_mask),
            }
        result["variables"][variable_id] = entry

        if variable_id in {"air_temperature", "specific_humidity", "precipitation"}:
            path = trend_quicklook(variable_id, main_class, witness_class)
            result["quicklooks"].append(str(path.relative_to(PROJECT_ROOT)))

    # Specific question 1: 2001-2006 global-land humidity change.
    main_years, main_series = annual_series(
        MAIN_ANOMALIES / "specific_humidity.nc", "specific_humidity", mask
    )
    witness_years, witness_series = annual_series(
        WITNESS_ANOMALIES / "specific_humidity.nc", "specific_humidity", mask
    )
    main_lookup = dict(zip(main_years, main_series))
    witness_lookup = dict(zip(witness_years, witness_series))
    result["specific_questions"]["humidity_2001_2006"] = {
        "main_product": "GLDAS specific_humidity",
        "witness_product": "MERRA-2 QV2M",
        "unit": "g kg-1",
        "main_2001": main_lookup.get(2001),
        "main_2006": main_lookup.get(2006),
        "main_change": (
            main_lookup.get(2006) - main_lookup.get(2001)
            if main_lookup.get(2001) is not None and main_lookup.get(2006) is not None
            else None
        ),
        "witness_2001": witness_lookup.get(2001),
        "witness_2006": witness_lookup.get(2006),
        "witness_change": (
            witness_lookup.get(2006) - witness_lookup.get(2001)
            if witness_lookup.get(2001) is not None and witness_lookup.get(2006) is not None
            else None
        ),
    }

    # Specific question 2: Vietnam 2012 air-temperature jump.
    vietnam = countries.get("Vietnam")
    if vietnam is not None:
        main_years, main_series = annual_series(
            MAIN_ANOMALIES / "air_temperature.nc", "air_temperature", vietnam
        )
        witness_years, witness_series = annual_series(
            WITNESS_ANOMALIES / "air_temperature.nc", "air_temperature", vietnam
        )
        main_lookup = dict(zip(main_years, main_series))
        witness_lookup = dict(zip(witness_years, witness_series))
        main_break = pettitt_test(main_series)
        witness_break = pettitt_test(witness_series)
        result["specific_questions"]["vietnam_t2m_2012"] = {
            "main_product": "GLDAS air_temperature",
            "witness_product": "MERRA-2 T2M",
            "unit": "degC",
            "main_2011": main_lookup.get(2011),
            "main_2012": main_lookup.get(2012),
            "main_jump": (
                main_lookup.get(2012) - main_lookup.get(2011)
                if main_lookup.get(2011) is not None and main_lookup.get(2012) is not None
                else None
            ),
            "witness_2011": witness_lookup.get(2011),
            "witness_2012": witness_lookup.get(2012),
            "witness_jump": (
                witness_lookup.get(2012) - witness_lookup.get(2011)
                if witness_lookup.get(2011) is not None and witness_lookup.get(2012) is not None
                else None
            ),
            "main_pettitt_break_year": main_years[int(main_break["change_index"]) + 1],
            "witness_pettitt_break_year": witness_years[int(witness_break["change_index"]) + 1],
            "main_pettitt_p": main_break["p"],
            "witness_pettitt_p": witness_break["p"],
        }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    print(f"\nSanity written to {OUT_PATH}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
