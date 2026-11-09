#!/usr/bin/env python
"""P02 anomaly runner (README §5 decisions 2-3).

Writes all 7 anomaly files (``data/processed/anomalies/{variable_id}.nc``,
``anomaly`` stored float64 to avoid Mann-Kendall quantization ties) and
copies the common mask to ``data/processed/anomalies/common_mask.nc`` so
that P03 and P-EXPORT defaults both work (the canonical mask stays in
``data/interim/harmonized_monthly/common_mask.nc``).

Usage:
    .venv/Scripts/python scripts/p02_anomalies.py [--variable ID]
"""

from __future__ import annotations

import argparse
import shutil
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from earthpulse.anomalies import write_anomalies  # noqa: E402
from earthpulse.harmonize import load_registry  # noqa: E402

INTERIM_DIR = PROJECT_ROOT / "data" / "interim" / "harmonized_monthly"
ANOMALY_DIR = PROJECT_ROOT / "data" / "processed" / "anomalies"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--variable", help="process a single variable id")
    args = parser.parse_args()

    registry = load_registry()
    variables = registry["variables"]
    if args.variable:
        variables = [v for v in variables if v["id"] == args.variable]
        if not variables:
            print(f"Unknown variable id {args.variable!r}", file=sys.stderr)
            return 2

    for variable in variables:
        cube_path = INTERIM_DIR / f"{variable['id']}.nc"
        if not cube_path.exists():
            print(f"  {variable['id']}: missing harmonized cube {cube_path.name}; "
                  "run scripts/p02_harmonize.py first", file=sys.stderr)
            return 1
        start = time.perf_counter()
        out_path = write_anomalies(
            cube_path, ANOMALY_DIR / f"{variable['id']}.nc", variable["id"]
        )
        elapsed = time.perf_counter() - start
        print(f"  {variable['id']}: anomalies written in {elapsed:.1f}s "
              f"-> {out_path}", flush=True)

    # README §5 decision 2: the anomaly runner also copies the common mask
    # so P03 and P-EXPORT defaults both work.
    canonical_mask = INTERIM_DIR / "common_mask.nc"
    mask_copy = ANOMALY_DIR / "common_mask.nc"
    if canonical_mask.exists():
        shutil.copyfile(canonical_mask, mask_copy)
        print(f"  common_mask copied: {mask_copy}", flush=True)
    else:
        print(f"  WARNING: {canonical_mask} not found; mask copy skipped. "
              "Run scripts/p02_harmonize.py without --skip-mask.", file=sys.stderr)
        return 1

    print(f"RESULT: OK ({len(variables)} anomaly files + mask copy)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
