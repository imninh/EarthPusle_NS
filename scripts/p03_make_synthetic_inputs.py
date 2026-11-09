"""Generate SYNTHETIC P02-shaped inputs for the P03 demo run.

P03 develops on synthetic data until the real P02 outputs exist. This script
writes, under ``data/processed/trends/synthetic_demo/anomalies/`` (inside the
P03-owned tree, never under data/processed/anomalies/ which belongs to P02):

- ``{variable_id}.nc``  : monthly anomaly cube (time, lat, lon), 288 contract
  months, plus a climatology variable, global attr ``synthetic = 1``
- ``common_mask.nc``    : procedural synthetic land mask (~30% of the 60S-90N
  cells), global attr ``synthetic = 1``

The mask and the anomaly fields are deliberately simple: a shared spatial
trend pattern (warming-like positive trend over land, mixed sign patches) +
AR(1) noise + a couple of deliberately data-poor cells so the eligibility and
OUTSIDE_DOMAIN paths can be inspected. These files are synthetic test inputs;
they must never be presented as NASA results and the release check (P07)
rejects any shipped file carrying ``synthetic: true``.

Usage:  .venv/Scripts/python scripts/p03_make_synthetic_inputs.py
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import xarray as xr
import yaml

from earthpulse.contract import (
    N_COLS,
    N_MONTHS,
    N_ROWS,
    col_to_lon,
    row_to_lat,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = PROJECT_ROOT / "data" / "processed" / "trends" / "synthetic_demo" / "anomalies"
SEED = 20261109


def make_mask(rng: np.random.Generator) -> np.ndarray:
    """Procedural synthetic land mask: ~30% of cells between 55S and 85N."""
    mask = np.zeros((N_ROWS, N_COLS), dtype=bool)
    lats = np.array([row_to_lat(r) for r in range(N_ROWS)])
    candidate = (lats >= -55.5) & (lats <= 84.5)
    keep = rng.random((N_ROWS, N_COLS)) < 0.30
    mask[candidate, :] = keep[candidate, :]
    return mask


def make_anomaly_cube(
    variable_id: str, display_unit: str, mask: np.ndarray, rng: np.random.Generator
) -> np.ndarray:
    """(288, 180, 360) synthetic monthly anomalies: trend field + AR(1) noise."""
    n_lat, n_lon = mask.shape
    # Spatial trend field: moderate positive baseline, a few mixed patches.
    ridx = np.arange(n_lat)[:, None]
    cidx = np.arange(n_lon)[None, :]
    trend = 0.01 * np.sin(ridx / 25.0) - 0.008 * np.cos(cidx / 60.0)
    patch = (
        (np.exp(-(((ridx - 60) / 18.0) ** 2 + ((cidx - 120) / 25.0) ** 2)) * 0.03)
        - (np.exp(-(((ridx - 95) / 15.0) ** 2 + ((cidx - 260) / 30.0) ** 2)) * 0.02)
    )
    slope = (trend + patch) / 12.0  # per month
    scale = 1.0 if "temperature" in variable_id else 0.5

    t = np.arange(N_MONTHS, dtype=float)[:, None, None]
    ar = np.zeros((N_MONTHS, n_lat, n_lon))
    noise = rng.normal(0.0, scale, size=(N_MONTHS, n_lat, n_lon))
    phi = 0.4
    ar[0] = noise[0]
    for k in range(1, N_MONTHS):
        ar[k] = phi * ar[k - 1] + noise[k]

    anomaly = slope[None, :, :] * t + ar
    anomaly[:, ~mask] = np.nan
    # A few inside-mask cells with heavy gaps (forces INSUFFICIENT_DATA).
    poor = rng.random((n_lat, n_lon)) < 0.002
    poor &= mask
    drop = rng.random((N_MONTHS, n_lat, n_lon)) < 0.85
    drop &= poor[None, :, :]
    anomaly[drop] = np.nan
    return anomaly.astype(np.float32)


def main() -> None:
    rng = np.random.default_rng(SEED)
    registry = yaml.safe_load(
        (PROJECT_ROOT / "config" / "variables.yaml").read_text(encoding="utf-8")
    )
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    mask = make_mask(rng)
    print(f"synthetic mask: {int(mask.sum())} cells inside domain (of {mask.size})")

    lat = np.array([row_to_lat(r) for r in range(N_ROWS)])
    lon = np.array([col_to_lon(c) for c in range(N_COLS)])
    months = np.arange(np.datetime64("2001-01"), np.datetime64("2025-01"), dtype="datetime64[M]")

    mask_ds = xr.Dataset(
        {"common_mask": (("lat", "lon"), mask)},
        coords={"lat": lat, "lon": lon},
    )
    mask_ds.attrs = {
        "synthetic": 1,
        "note": "SYNTHETIC procedural land mask for P03 development only (seed 20261109); not NASA data.",
    }
    mask_path = OUT_DIR / "common_mask.nc"
    mask_ds.to_netcdf(mask_path, engine="netcdf4")
    print(f"wrote {mask_path}")

    for var in registry["variables"]:
        data = make_anomaly_cube(var["id"], var["display_unit"], mask, rng)
        clim = np.zeros((12, N_ROWS, N_COLS), dtype=np.float32)  # anomalies have zero climatology
        ds = xr.Dataset(
            {
                "anomaly": (("time", "lat", "lon"), data, {"units": var["display_unit"]}),
                "climatology": (("month", "lat", "lon"), clim, {"units": var["display_unit"]}),
            },
            coords={"time": months, "month": np.arange(1, 13), "lat": lat, "lon": lon},
        )
        ds.attrs = {
            "synthetic": 1,
            "note": f"SYNTHETIC anomaly cube for variable {var['id']}, P03 development only (seed 20261109); not NASA data.",
            "variable_id": var["id"],
            "units": var["display_unit"],
        }
        path = OUT_DIR / f"{var['id']}.nc"
        ds.to_netcdf(path, engine="netcdf4")
        print(f"wrote {path} ({data.nbytes / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
