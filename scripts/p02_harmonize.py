#!/usr/bin/env python
"""P02 T3+T4 runner: harmonize the 7 registry variables and build the mask.

Verifies that all 288 raw months per product are on disk (reports gaps,
never fills them), then writes one harmonized monthly cube per variable to
data/interim/harmonized_monthly/{variable_id}.nc and the common land mask
to data/interim/harmonized_monthly/common_mask.nc.

Usage:
    .venv/Scripts/python scripts/p02_harmonize.py [--variable ID] [--skip-mask]
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from earthpulse import contract  # noqa: E402
from earthpulse.harmonize import (  # noqa: E402
    build_common_mask,
    harmonize_variable,
    load_registry,
    verify_raw_coverage,
)

RAW_ROOT = PROJECT_ROOT / "data" / "raw"
INTERIM_DIR = PROJECT_ROOT / "data" / "interim" / "harmonized_monthly"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--variable", help="harmonize a single variable id")
    parser.add_argument("--skip-mask", action="store_true",
                        help="skip the common-mask step")
    args = parser.parse_args()

    registry = load_registry()
    variables = registry["variables"]
    if args.variable:
        variables = [v for v in variables if v["id"] == args.variable]
        if not variables:
            print(f"Unknown variable id {args.variable!r}", file=sys.stderr)
            return 2

    print("Checking raw coverage on disk ...", flush=True)
    missing = verify_raw_coverage(RAW_ROOT, registry)
    products_needed = {v["product"] for v in variables}
    complete = True
    for product, gaps in missing.items():
        if product not in products_needed:
            continue
        status = "OK" if not gaps else f"MISSING {len(gaps)} months"
        print(f"  {product}: {status}", flush=True)
        if gaps:
            print(f"    gaps: {gaps[:12]}{' ...' if len(gaps) > 12 else ''}",
                  flush=True)
            complete = False
    if not complete:
        print("RESULT: ABORTED - raw gaps above; run scripts/p02_download.py "
              "first. Gaps are never filled.", flush=True)
        return 1

    products = {name: cfg for name, cfg in registry["products"].items()}
    for variable in variables:
        product_cfg = products[variable["product"]]
        out_path = INTERIM_DIR / f"{variable['id']}.nc"
        start = time.perf_counter()
        harmonize_variable(variable, product_cfg, RAW_ROOT, out_path)
        elapsed = time.perf_counter() - start
        print(f"  {variable['id']}: harmonized in {elapsed:.1f}s -> {out_path.name}",
              flush=True)

    if not args.skip_mask:
        start = time.perf_counter()
        mask = build_common_mask(
            load_registry(), INTERIM_DIR, INTERIM_DIR / "common_mask.nc"
        )
        elapsed = time.perf_counter() - start
        attrs = mask.attrs
        print(f"  common_mask.nc written in {elapsed:.1f}s: "
              f"{attrs['n_cells_common']} cells inside domain "
              f"({attrs['n_cells_removed_by_gldas']} removed by GLDAS "
              f"criterion, {attrs['n_cells_removed_by_imerg']} additionally "
              "by IMERG criterion)", flush=True)

    print(f"RESULT: OK ({contract.N_MONTHS} months per variable)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
