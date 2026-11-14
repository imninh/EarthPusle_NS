#!/usr/bin/env python
"""G1 sanity table and three quick-look maps for the four pilot variables.

Reads data/processed/trends/{variable}/2001-2024.nc and the common land mask,
prints an area-weighted global-land mean Sen slope per decade and the
area-weighted share of significant cells, then writes three PNGs to
data/processed/g1_quicklooks/. No values are typed in by hand.

    .venv/Scripts/python scripts/g1_sanity.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import xarray as xr

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from earthpulse import contract  # noqa: E402
from earthpulse.harmonize import load_registry  # noqa: E402

TRENDS = PROJECT_ROOT / "data" / "processed" / "trends"
ANOMALIES = PROJECT_ROOT / "data" / "processed" / "anomalies"
OUT = PROJECT_ROOT / "data" / "processed" / "g1_quicklooks"
WINDOW = "2001-2024"
PILOT = (
    "air_temperature_850hpa",
    "air_temperature_500hpa",
    "column_water_vapor",
    "total_ozone",
)


def main() -> int:
    registry = load_registry()
    rows = {v["id"]: v for v in registry["variables"]}
    with xr.open_dataset(ANOMALIES / "common_mask.nc") as ds:
        mask = np.asarray(ds["common_mask"].values, dtype=bool)
    lat = contract.LAT_NORTH_CENTER - np.arange(contract.N_ROWS) * contract.RESOLUTION_DEG
    weights = np.cos(np.deg2rad(lat))[:, None] * np.ones((1, contract.N_COLS))

    summary = {}
    maps = {}
    for variable_id in PILOT:
        with xr.open_dataset(TRENDS / variable_id / f"{WINDOW}.nc") as ds:
            slope = np.asarray(ds["sen_slope_decade"].values, dtype=float)
            classes = np.asarray(ds["trend_class"].values)
        evaluated = mask & np.isfinite(slope)
        w = weights[evaluated]
        mean_slope = float(np.sum(slope[evaluated] * w) / np.sum(w))
        significant = evaluated & np.isin(classes, (contract.TREND_INCREASE, contract.TREND_DECREASE))
        sig_share = float(np.sum(weights[significant]) / np.sum(w))
        summary[variable_id] = {
            "unit": rows[variable_id]["display_unit"],
            "mean_slope_decade": mean_slope,
            "sig_area_share": sig_share,
            "cells_evaluated": int(evaluated.sum()),
        }
        maps[variable_id] = np.where(mask, slope, np.nan)

    print(f"{'variable':28s} {'mean trend / decade':>22s} {'sig. area':>10s} {'cells':>7s}")
    for variable_id, item in summary.items():
        print(
            f"{variable_id:28s} {item['mean_slope_decade']:>12.4f} {item['unit']:>9s}"
            f" {100.0 * item['sig_area_share']:>9.1f}% {item['cells_evaluated']:>7d}"
        )

    OUT.mkdir(parents=True, exist_ok=True)
    extent = (-180.0, 180.0, -90.0, 90.0)
    panels = {
        "g1_temperature_levels.png": ("air_temperature_850hpa", "air_temperature_500hpa"),
        "g1_column_water_vapor.png": ("column_water_vapor",),
        "g1_total_ozone.png": ("total_ozone",),
    }
    for filename, variable_ids in panels.items():
        fig, axes = plt.subplots(
            1, len(variable_ids), figsize=(6.4 * len(variable_ids), 3.4), squeeze=False
        )
        for ax, variable_id in zip(axes[0], variable_ids):
            item = summary[variable_id]
            layer = maps[variable_id]
            limit = float(np.nanpercentile(np.abs(layer), 98)) or 1.0
            image = ax.imshow(
                layer,
                origin="upper",
                extent=extent,
                cmap="RdBu_r",
                vmin=-limit,
                vmax=limit,
                interpolation="nearest",
                aspect="auto",
            )
            ax.set_title(
                f"{rows[variable_id]['label']}\nmean {item['mean_slope_decade']:+.3f} "
                f"{item['unit']} per decade; {100.0 * item['sig_area_share']:.1f}% significant",
                fontsize=8,
            )
            ax.set_xlabel("longitude")
            ax.set_ylabel("latitude")
            fig.colorbar(image, ax=ax, shrink=0.8, label=f"{item['unit']} per decade")
        fig.tight_layout()
        path = OUT / filename
        fig.savefig(path, dpi=150)
        plt.close(fig)
        print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
