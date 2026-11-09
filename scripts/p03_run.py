"""P03 driver: run trends for all registry variables x windows and Spearman
correlations for all pairs among the core variables (docs/packages/specs/P03_statistical_engine.md
section 2), writing the contract NetCDFs under data/processed/.

Modes:
- default (real):      inputs  data/processed/anomalies/{variable}.nc + common_mask.nc (P02)
                       outputs data/processed/trends/{variable}/{window}.nc
                              data/processed/correlations/{pair}/{window}.nc
- --synthetic-demo:    synthetic inputs/outputs under
                       data/processed/trends/synthetic_demo/{anomalies,trends,correlations}/
                       (outputs flagged synthetic; run
                       scripts/p03_make_synthetic_inputs.py first)

Usage:
  .venv/Scripts/python scripts/p03_run.py                 # real inputs (after P02)
  .venv/Scripts/python scripts/p03_run.py --synthetic-demo
"""

from __future__ import annotations

import argparse
import itertools
import json
import time
from pathlib import Path

import numpy as np
import yaml

from earthpulse.contract import WINDOWS
from earthpulse.stats.run import compute_trend, run_correlations, run_trends

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEMO_ROOT = PROJECT_ROOT / "data" / "processed" / "trends" / "synthetic_demo"


def registry_variables(registry: dict) -> list[dict]:
    """All verified registry variables (the spec: all 7 x 3 windows)."""
    return [v for v in registry["variables"] if v.get("verified")]


def core_variables(registry: dict) -> list[dict]:
    core = [v for v in registry["variables"] if v.get("core") and v.get("verified")]
    return sorted(core, key=lambda v: v["id"])


def pair_id(a: str, b: str) -> str:
    return "__".join(sorted((a, b)))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--synthetic-demo",
        action="store_true",
        help="run on the synthetic demo inputs under data/processed/trends/synthetic_demo/",
    )
    args = parser.parse_args()

    synthetic = args.synthetic_demo
    if synthetic:
        anomaly_dir = DEMO_ROOT / "anomalies"
        trends_out = DEMO_ROOT / "trends"
        corr_out = DEMO_ROOT / "correlations"
    else:
        anomaly_dir = None  # run.py defaults: data/processed/anomalies
        trends_out = None
        corr_out = None

    registry = yaml.safe_load(
        (PROJECT_ROOT / "config" / "variables.yaml").read_text(encoding="utf-8")
    )
    variables = registry_variables(registry)
    var_ids = [v["id"] for v in variables]
    pairs = sorted(
        {pair_id(a, b) for a, b in itertools.combinations(sorted(v["id"] for v in core_variables(registry)), 2)}
    )
    window_ids = sorted(WINDOWS)
    print(f"variables ({len(var_ids)}): {var_ids}")
    print(f"pairs ({len(pairs)}): {pairs}")
    print(f"windows: {window_ids}")
    print(f"mode: {'SYNTHETIC DEMO' if synthetic else 'real (P02 outputs)'}")

    timings: dict[str, dict[str, float]] = {"trends": {}, "correlations": {}}
    for window_id in window_ids:
        trend_cache: dict[str, tuple[dict, dict]] = {}
        for vid in var_ids:
            t0 = time.perf_counter()
            layers, extras = compute_trend(vid, window_id, anomaly_dir=anomaly_dir)
            trend_cache[vid] = (layers, extras)
            run_trends(
                vid,
                window_id,
                anomaly_dir=anomaly_dir,
                out_dir=trends_out,
                synthetic=synthetic,
                trend=(layers, extras),
            )
            dt = time.perf_counter() - t0
            timings["trends"][f"{vid}/{window_id}"] = dt
            n_eval = int(np_count_evaluated(layers))
            print(f"  trends {vid} [{window_id}]: {dt:.1f}s, evaluated cells: {n_eval}")

        for p in pairs:
            t0 = time.perf_counter()
            run_correlations(
                p,
                window_id,
                anomaly_dir=anomaly_dir,
                out_dir=corr_out,
                synthetic=synthetic,
                trend_results=trend_cache,
            )
            dt = time.perf_counter() - t0
            timings["correlations"][f"{p}/{window_id}"] = dt
            print(f"  correlations {p} [{window_id}]: {dt:.1f}s")

    report = {
        "mode": "synthetic_demo" if synthetic else "real",
        "timings_seconds": timings,
        "total_seconds": sum(timings["trends"].values()) + sum(timings["correlations"].values()),
    }
    out_json = (DEMO_ROOT if synthetic else PROJECT_ROOT / "data" / "processed") / "p03_timings.json"
    out_json.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\ntotal: {report['total_seconds']:.1f}s; timings written to {out_json}")


def np_count_evaluated(layers: dict) -> int:
    return int(np.isfinite(layers["q_value"]).sum())


if __name__ == "__main__":
    main()
