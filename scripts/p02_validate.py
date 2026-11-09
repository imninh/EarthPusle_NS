#!/usr/bin/env python
"""P02 T6: validation outputs and quick-look maps.

Writes ``data/processed/anomalies/p02_validation.json`` with, per variable:
valid-cell count, min/max/mean of values and anomalies, months with all-NaN
grids, and a global area-weighted monthly mean series (plausibility check).
Also renders quick-look PNGs (one month of values and of anomalies per
variable, plus the common mask) into ``data/metadata/quicklook_p02/``.

Usage:
    .venv/Scripts/python scripts/p02_validate.py [--month 2021-01]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import xarray as xr

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from earthpulse import contract  # noqa: E402
from earthpulse.grid import cell_area_weights  # noqa: E402
from earthpulse.harmonize import load_registry  # noqa: E402

INTERIM_DIR = PROJECT_ROOT / "data" / "interim" / "harmonized_monthly"
ANOMALY_DIR = PROJECT_ROOT / "data" / "processed" / "anomalies"
QUICKLOOK_DIR = PROJECT_ROOT / "data" / "metadata" / "quicklook_p02"


def label_for(index: int) -> str:
    """YYYY-MM label for month ``index`` (0-based from 2001-01)."""
    year = 2001 + index // 12
    month = index % 12 + 1
    return f"{year:04d}-{month:02d}"


def area_weighted_mean(values: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Global area-weighted monthly mean over valid cells, per month."""
    weights = cell_area_weights(lat)[None, :, None]  # (1, n_lat, 1)
    valid = np.isfinite(values)
    weighted = np.where(valid, values * weights, 0.0)
    denominator = (weights * valid).sum(axis=(1, 2))
    numerator = weighted.sum(axis=(1, 2))
    return np.where(denominator > 0, numerator / denominator, np.nan)


def variable_stats(cube_path: Path, anomaly_path: Path, variable_id: str) -> dict:
    with xr.open_dataset(cube_path) as cube:
        values = cube[variable_id].values.astype(np.float64)
        lat = cube["lat"].values
        units = cube.attrs.get("units")
    with xr.open_dataset(anomaly_path) as ds:
        anomalies = ds["anomaly"].values.astype(np.float64)

    def stats(field: np.ndarray) -> dict:
        finite = field[np.isfinite(field)]
        return {
            "min": float(finite.min()) if finite.size else None,
            "max": float(finite.max()) if finite.size else None,
            "mean": float(finite.mean()) if finite.size else None,
        }

    all_nan_months = [
        label_for(i) for i in range(values.shape[0]) if not np.isfinite(values[i]).any()
    ]
    return {
        "variable": variable_id,
        "units": units,
        "valid_cell_count": int(np.isfinite(values).any(axis=0).sum()),
        "values": stats(values),
        "anomalies": stats(anomalies),
        "months_with_all_nan": all_nan_months,
        "global_area_weighted_monthly_mean": [
            None if not np.isfinite(v) else float(v)
            for v in area_weighted_mean(values, lat)
        ],
    }


def quicklook(
    field: np.ndarray,
    lat: np.ndarray,
    lon: np.ndarray,
    out_path: Path,
    title: str,
    label: str,
) -> Path:
    """Render one north-up quick-look map (row 0 = north)."""
    finite = field[np.isfinite(field)]
    if finite.size:
        vmin, vmax = np.nanpercentile(finite, [2, 98])
        if not np.isfinite(vmin) or not np.isfinite(vmax) or vmin == vmax:
            vmin, vmax = float(finite.min()), float(finite.max())
    else:
        vmin = vmax = None

    figure, axis = plt.subplots(figsize=(10, 5), constrained_layout=True)
    image = axis.imshow(
        field,
        origin="upper",  # row 0 (north) at the top
        extent=[lon.min() - 0.5, lon.max() + 0.5, lat.min() - 0.5, lat.max() + 0.5],
        aspect="auto",
        cmap="viridis",
        vmin=vmin,
        vmax=vmax,
    )
    figure.colorbar(image, ax=axis, shrink=0.8, label=label)
    axis.set_title(title)
    axis.set_xlabel("Longitude (degrees_east)")
    axis.set_ylabel("Latitude (degrees_north)")
    axis.set_xlim(-180, 180)
    axis.set_ylim(-90, 90)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(out_path, dpi=120)
    plt.close(figure)
    return out_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--month", default="2021-01",
                        help="YYYY-MM month for the quick-look maps "
                        "(default: 2021-01, first post-baseline January)")
    args = parser.parse_args()

    registry = load_registry()
    month_index = None
    for index in range(contract.N_MONTHS):
        year = 2001 + index // 12
        month = index % 12 + 1
        if f"{year:04d}-{month:02d}" == args.month:
            month_index = index
            break
    if month_index is None:
        print(f"Month {args.month} outside {contract.FIRST_MONTH}.."
              f"{contract.LAST_MONTH}", file=sys.stderr)
        return 2

    report: dict = {"generated_for_month": args.month, "variables": []}
    for variable in registry["variables"]:
        variable_id = variable["id"]
        cube_path = INTERIM_DIR / f"{variable_id}.nc"
        anomaly_path = ANOMALY_DIR / f"{variable_id}.nc"
        if not cube_path.exists() or not anomaly_path.exists():
            print(f"  {variable_id}: missing cube or anomaly file; skipped",
                  flush=True)
            continue

        report["variables"].append(variable_stats(cube_path, anomaly_path, variable_id))

        with xr.open_dataset(cube_path) as cube:
            values = cube[variable_id].values.astype(np.float64)[month_index]
            lat = cube["lat"].values
            lon = cube["lon"].values
            units = cube.attrs.get("units")
        with xr.open_dataset(anomaly_path) as ds:
            anomalies = ds["anomaly"].values.astype(np.float64)[month_index]

        quicklook(
            values, lat, lon,
            QUICKLOOK_DIR / f"{variable_id}_values_{args.month}.png",
            f"{variable['label']} - values {args.month} ({units})",
            units,
        )
        quicklook(
            anomalies, lat, lon,
            QUICKLOOK_DIR / f"{variable_id}_anomalies_{args.month}.png",
            f"{variable['label']} - anomalies {args.month} ({units})",
            f"anomaly ({units})",
        )
        print(f"  {variable_id}: stats + quicklooks written", flush=True)

    mask_path = INTERIM_DIR / "common_mask.nc"
    if mask_path.exists():
        with xr.open_dataset(mask_path) as mask_ds:
            mask = mask_ds["common_mask"].values.astype(float)
            mask_plot = np.where(mask == 1, 1.0, np.nan)
        quicklook(
            mask_plot, mask_ds["lat"].values, mask_ds["lon"].values,
            QUICKLOOK_DIR / "common_mask.png",
            "Common land mask (contract domain)",
            "inside domain",
        )
        report["common_mask"] = {
            "n_cells_inside": int((mask == 1).sum()),
            "n_cells_total": int(mask.size),
        }

    out_path = ANOMALY_DIR / "p02_validation.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Validation report written to {out_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
