#!/usr/bin/env python
"""G1 (P24 T2 pilot): harmonize, anomalies and trends for the four MERRA-2 variables.

Same code paths as the existing seven: ``earthpulse.harmonize`` (conservative
P13 regridder for M2TMNXSLV), ``earthpulse.anomalies.write_anomalies`` and
``earthpulse.stats.run.run_trends``. Resumable per step (``--force`` redoes).
Timings go to data/processed/g1_timings.json.

    .venv/Scripts/python scripts/g1_run.py
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

import xarray as xr  # noqa: E402

from earthpulse import witness  # noqa: E402
from earthpulse.anomalies import write_anomalies  # noqa: E402
from earthpulse.contract import WINDOWS  # noqa: E402
from earthpulse.harmonize import (  # noqa: E402
    expected_months,
    find_raw_file,
    harmonize_variable_conservative,
    load_registry,
)
from earthpulse.stats.run import run_trends  # noqa: E402

RAW_ROOT = PROJECT_ROOT / "data" / "raw"
INTERIM = PROJECT_ROOT / "data" / "interim" / "harmonized_monthly"
ANOM = PROJECT_ROOT / "data" / "processed" / "anomalies"
TRENDS = PROJECT_ROOT / "data" / "processed" / "trends"
TIMINGS = PROJECT_ROOT / "data" / "processed" / "g1_timings.json"
PILOT = ("air_temperature_850hpa", "air_temperature_500hpa", "column_water_vapor", "total_ozone")


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--variable", action="append")
    args = ap.parse_args()
    registry = load_registry()
    product = registry["products"]["M2TMNXSLV"]
    rows = {v["id"]: v for v in registry["variables"]}
    ids = args.variable or list(PILOT)
    # One process per variable is the documented parallel mode; keep its timing
    # file separate so parallel runs cannot overwrite each other.
    timings_path = TIMINGS if len(ids) > 1 else TIMINGS.with_name(
        f"g1_timings_{ids[0]}.json"
    )
    timings: dict[str, float] = {}

    first = find_raw_file(RAW_ROOT, "M2TMNXSLV", *expected_months()[0])
    with xr.open_dataset(first, decode_times=False, mask_and_scale=False) as ds:
        src_lat, src_lon = ds["lat"].values, ds["lon"].values
    t0 = time.perf_counter()
    weights = witness.build_overlap_weights(src_lat, src_lon)
    timings["weights"] = time.perf_counter() - t0
    log(f"weights {weights.nnz} overlaps in {timings['weights']:.1f}s")

    for vid in ids:
        cfg = rows[vid]
        cube = INTERIM / f"{vid}.nc"
        if args.force or not cube.is_file():
            t0 = time.perf_counter()
            harmonize_variable_conservative(cfg, product, RAW_ROOT, cube, weights=weights)
            timings[f"{vid}/harmonize"] = time.perf_counter() - t0
            log(f"{vid}: harmonized {timings[f'{vid}/harmonize']:.1f}s")
        anom = ANOM / f"{vid}.nc"
        if args.force or not anom.is_file():
            t0 = time.perf_counter()
            write_anomalies(cube, anom, vid)
            timings[f"{vid}/anomalies"] = time.perf_counter() - t0
            log(f"{vid}: anomalies {timings[f'{vid}/anomalies']:.1f}s")
        timings_path.write_text(json.dumps(timings, indent=2), encoding="utf-8")

    for vid in ids:
        for window in sorted(WINDOWS):
            out = TRENDS / vid / f"{window}.nc"
            if out.is_file() and not args.force:
                continue
            t0 = time.perf_counter()
            run_trends(vid, window)
            timings[f"{vid}/trend/{window}"] = time.perf_counter() - t0
            log(f"{vid} [{window}]: trend {timings[f'{vid}/trend/{window}']:.1f}s")
            timings_path.write_text(json.dumps(timings, indent=2), encoding="utf-8")
    log("RESULT: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
