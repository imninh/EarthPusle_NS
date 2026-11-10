#!/usr/bin/env python
"""P13 T4: run the unchanged P03 trend engine on the witness anomalies.

Writes ``data/processed/witness/trends/{variable}/{window}.nc`` with exactly
the same layer names, eligibility rules, Sen slope, Hamed-Rao MK and BH-FDR
as the main P03 outputs. The main common mask is passed explicitly.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from earthpulse.contract import WINDOWS  # noqa: E402
from earthpulse.stats.run import run_trends  # noqa: E402
from earthpulse.witness import load_witness_config  # noqa: E402

ANOMALY_DIR = PROJECT_ROOT / "data" / "processed" / "witness" / "anomalies"
TRENDS_DIR = PROJECT_ROOT / "data" / "processed" / "witness" / "trends"
MASK_PATH = PROJECT_ROOT / "data" / "interim" / "harmonized_monthly" / "common_mask.nc"


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--variable",
        action="append",
        default=None,
        help="variable id to process (default: all in config)",
    )
    args = parser.parse_args()
    config = load_witness_config()
    variables = args.variable or list(config["variables"])
    unknown = [name for name in variables if name not in config["variables"]]
    if unknown:
        print(f"Unknown variable(s): {unknown}", file=sys.stderr)
        return 2
    TRENDS_DIR.mkdir(parents=True, exist_ok=True)
    timings: dict[str, float] = {}
    for window_id in sorted(WINDOWS):
        for variable_id in variables:
            started = time.perf_counter()
            path = run_trends(
                variable_id,
                window_id,
                anomaly_dir=ANOMALY_DIR,
                mask_file=MASK_PATH,
                out_dir=TRENDS_DIR,
            )
            elapsed = time.perf_counter() - started
            timings[f"{variable_id}/{window_id}"] = elapsed
            print(f"  {variable_id} [{window_id}]: {elapsed:.1f}s -> {path.name}",
                  flush=True)

    report = {
        "mode": "witness",
        "timings_seconds": timings,
        "total_seconds": sum(timings.values()),
        "variables": sorted(variables),
        "windows": sorted(WINDOWS),
        "engine": "earthpulse.stats.run.run_trends (unchanged P03 engine)",
    }
    timings_path = TRENDS_DIR.parent / "trends_timings.json"
    if timings_path.is_file():
        try:
            previous = json.loads(timings_path.read_text(encoding="utf-8"))
            merged = dict(previous.get("timings_seconds", {}))
            merged.update(timings)
            report["timings_seconds"] = merged
            report["total_seconds"] = sum(merged.values())
        except json.JSONDecodeError:
            pass
    timings_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"RESULT: OK ({len(timings)} trend files, "
          f"{report['total_seconds']:.1f}s total)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
