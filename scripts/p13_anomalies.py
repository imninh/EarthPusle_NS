#!/usr/bin/env python
"""P13 T3: monthly anomalies for the witness cubes.

Uses the same 2001-2020 calendar-month climatology and the same anomaly
definition as P02 (``earthpulse.anomalies``), but writes into the P13 tree.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import xarray as xr

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from earthpulse.anomalies import compute_anomalies  # noqa: E402
from earthpulse.witness import load_witness_config  # noqa: E402

INTERIM_DIR = PROJECT_ROOT / "data" / "interim" / "witness"
OUT_DIR = PROJECT_ROOT / "data" / "processed" / "witness" / "anomalies"


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
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for variable_id in variables:
        path = INTERIM_DIR / f"{variable_id}.nc"
        if not path.is_file():
            print(f"missing witness cube: {path}", file=sys.stderr)
            return 1
        with xr.open_dataset(path, engine="netcdf4") as ds:
            values = ds[variable_id].load()
            attrs = dict(ds.attrs)
        anomaly, climatology = compute_anomalies(values)
        dataset = xr.Dataset(
            {
                "anomaly": anomaly.astype("float64"),
                "climatology": climatology.astype("float32"),
            },
            attrs={
                **attrs,
                "title": f"P13 witness monthly anomalies: {variable_id}",
                "baseline": "2001-01..2020-12",
                "min_baseline_years": 15,
                "anomaly_definition": "value - baseline climatology (calendar month)",
                "anomaly_dtype_note": "float64 to avoid Mann-Kendall quantization ties",
                "package": "P13",
            },
        )
        out = OUT_DIR / f"{variable_id}.nc"
        dataset.to_netcdf(
            out,
            engine="netcdf4",
            encoding={
                "anomaly": {"dtype": "float64", "zlib": True, "complevel": 4},
                "climatology": {"dtype": "float32", "zlib": True, "complevel": 4},
            },
        )
        dataset.close()
        written.append(variable_id)
        print(f"  {variable_id}: anomalies -> {out}", flush=True)

    summary = {"variables": written, "baseline": "2001-01..2020-12"}
    (OUT_DIR.parent / "anomalies_summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    print(f"RESULT: OK ({len(written)} anomaly cubes)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
