#!/usr/bin/env python
"""P02 T1: bulk download of the monthly NASA granules (2001-01 .. 2024-12).

Downloads all 288 monthly granules of GLDAS_NOAH10_M (V2.1) and GPM_3IMERGM
(V07) into data/raw/gldas/ and data/raw/gpm/ using earthaccess with the
user's netrc credentials (strategy="netrc").

Resumable: an existing file is skipped when its size matches the granule
size reported by CMR (within 1 %); otherwise it is re-downloaded. Failed
granules are retried up to ``MAX_ATTEMPTS`` times. A JSON summary with
downloaded / skipped / failed counts is written to
data/raw/download_summary.json and printed at the end.

Usage:
    .venv/Scripts/python scripts/p02_download.py [--product gldas|gpm|both]

Exit code 0 only when all 288 months of every requested product are present.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import earthaccess

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from earthpulse import ingest  # noqa: E402  (import after sys.path setup)

RAW_ROOT = PROJECT_ROOT / "data" / "raw"
SUMMARY_PATH = RAW_ROOT / "download_summary.json"

MAX_ATTEMPTS = 3
RETRY_SLEEP_S = 10
SIZE_TOLERANCE = 0.01  # relative tolerance when comparing existing file size

PRODUCTS = {
    "gldas": {"short_name": "GLDAS_NOAH10_M", "version": "2.1", "subdir": "gldas"},
    "gpm": {"short_name": "GPM_3IMERGM", "version": "07", "subdir": "gpm"},
}

# Expected months: 2001-01 .. 2024-12
EXPECTED_MONTHS: list[tuple[int, int]] = [
    (year, month) for year in range(2001, 2025) for month in range(1, 13)
]


def month_key(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def month_from_granule(granule: dict, file_name: str) -> tuple[int, int] | None:
    """Return (year, month) from the granule's temporal extent.

    Falls back to the file name when CMR metadata is incomplete. File-name
    patterns (verified by P01): GLDAS ``...A200101.021.nc4`` (YYYYMM);
    IMERG ``...3IMERG.20010101-S000000-...`` (YYYYMMDD).
    """
    umm = granule.get("umm", {})
    # Granule UMM uses singular keys (TemporalExtent/RangeDateTime); the
    # collection UMM used by ingest uses plural ones. Try both.
    for path in (
        ("TemporalExtent", "RangeDateTime", "BeginningDateTime"),
        ("TemporalExtents", "RangeDateTimes", "BeginningDateTime"),
    ):
        node: object = umm
        try:
            for key in path:
                node = node[key]
            dt = datetime.fromisoformat(str(node).replace("Z", "+00:00"))
            return dt.year, dt.month
        except (KeyError, IndexError, TypeError, ValueError):
            continue
    match = re.search(r"\.A(\d{4})(\d{2})\.", file_name)  # GLDAS A200101 (YYYYMM)
    if match:
        return int(match.group(1)), int(match.group(2))
    match = re.search(r"3IMERG\.(\d{4})(\d{2})\d{2}-", file_name)  # IMERG YYYYMMDD
    if match:
        return int(match.group(1)), int(match.group(2))
    return None


def size_matches(existing: Path, size_mb: float | None) -> bool:
    """True when the file exists and its size matches the CMR size (within 1 %)."""
    if not existing.exists():
        return False
    if size_mb is None or size_mb <= 0:
        return True  # no reference size; accept what is present
    actual = existing.stat().st_size
    expected = size_mb * 1_000_000.0
    return abs(actual - expected) / expected <= SIZE_TOLERANCE


def download_product(product_key: str) -> dict:
    """Download every month of one product and return a summary record."""
    product = PRODUCTS[product_key]
    spec = ingest.SPECS_BY_SHORT_NAME[product["short_name"]]
    out_dir = RAW_ROOT / product["subdir"]
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n=== {product['short_name']} v{product['version']} ===", flush=True)
    granules = earthaccess.search_data(
        short_name=product["short_name"],
        version=product["version"],
        temporal=(ingest.ANALYSIS_START, ingest.ANALYSIS_END),
    )
    print(f"CMR search returned {len(granules)} granules "
          f"(expected {len(EXPECTED_MONTHS)})", flush=True)

    by_month: dict[tuple[int, int], dict] = {}
    duplicates: list[tuple[int, int]] = []
    for granule in granules:
        record = ingest.granule_record(granule)
        key = month_from_granule(granule, record["granule_name"])
        if key is None:
            print(f"  WARNING: cannot determine month of "
                  f"{record['granule_name']}; skipped", flush=True)
            continue
        if key in by_month:
            duplicates.append(key)
        else:
            by_month[key] = {"granule": granule, "record": record}

    if duplicates:
        print(f"  WARNING: duplicate granules for months: "
              f"{sorted({month_key(*k) for k in duplicates})}", flush=True)

    summary = {
        "product": product["short_name"],
        "version": product["version"],
        "expected_months": len(EXPECTED_MONTHS),
        "granules_found": len(granules),
        "downloaded": 0,
        "skipped": 0,
        "failed": 0,
        "missing_months": [],
        "failed_months": [],
        "started_at": datetime.now(timezone.utc).isoformat(),
    }

    for year, month in EXPECTED_MONTHS:
        key = (year, month)
        label = month_key(year, month)
        entry = by_month.get(key)
        if entry is None:
            summary["missing_months"].append(label)
            summary["failed"] += 1
            print(f"  {label}: NO GRANULE in CMR search result", flush=True)
            continue

        record = entry["record"]
        destination = out_dir / record["granule_name"]
        size_mb = record.get("size_mb")

        if destination.exists() and size_matches(destination, size_mb):
            summary["skipped"] += 1
            continue

        if destination.exists():
            print(f"  {label}: existing file size mismatch "
                  f"({destination.stat().st_size} bytes vs CMR {size_mb} MB); "
                  "re-downloading", flush=True)

        attempts_left = MAX_ATTEMPTS
        while attempts_left > 0:
            try:
                downloaded = earthaccess.download(
                    [entry["granule"]], local_path=str(out_dir),
                    show_progress=False,
                )
                if not downloaded:
                    raise RuntimeError("earthaccess.download returned no path")
                produced = Path(downloaded[0])
                if produced.resolve() != destination.resolve() and produced.exists():
                    produced.replace(destination)
                if not destination.exists():
                    raise RuntimeError(f"file not found after download: {destination}")
                summary["downloaded"] += 1
                print(f"  {label}: downloaded {destination.name} "
                      f"({destination.stat().st_size} bytes)", flush=True)
                break
            except Exception as exc:  # noqa: BLE001 - retry any download error
                attempts_left -= 1
                print(f"  {label}: attempt failed ({exc}); "
                      f"{attempts_left} attempts left", flush=True)
                if attempts_left > 0:
                    time.sleep(RETRY_SLEEP_S)
        else:
            summary["failed"] += 1
            summary["failed_months"].append(label)
            print(f"  {label}: FAILED after {MAX_ATTEMPTS} attempts", flush=True)

    summary["finished_at"] = datetime.now(timezone.utc).isoformat()
    return summary


def coverage_check() -> dict:
    """Verify that exactly 288 months exist on disk per product.

    Coverage is judged from file names, not from the CMR result, so a stale
    search cannot hide a gap.
    """
    patterns = {
        "gldas": re.compile(r"^GLDAS_NOAH10_M\.A(\d{4})(\d{2})\.021\.nc4$"),
        "gpm": re.compile(r"^3B-MO\.MS\.MRG\.3IMERG\.(\d{4})(\d{2})\d{2}-"),
    }
    result = {}
    for product_key, pattern in patterns.items():
        out_dir = RAW_ROOT / PRODUCTS[product_key]["subdir"]
        months = set()
        for path in out_dir.iterdir():
            match = pattern.match(path.name)
            if match:
                months.add((int(match.group(1)), int(match.group(2))))
        missing = [month_key(*m) for m in EXPECTED_MONTHS if m not in months]
        extra = sorted(
            month_key(*m) for m in months if m not in set(EXPECTED_MONTHS)
        )
        result[product_key] = {
            "months_on_disk": len(months),
            "expected": len(EXPECTED_MONTHS),
            "missing": missing,
            "extra": extra,
        }
        status = "OK" if not missing and not extra else "GAPS"
        print(f"{product_key}: {len(months)}/{len(EXPECTED_MONTHS)} months on disk "
              f"[{status}]", flush=True)
        if missing:
            print(f"  missing: {missing[:12]}"
                  f"{' ...' if len(missing) > 12 else ''}", flush=True)
        if extra:
            print(f"  extra: {extra}", flush=True)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--product", choices=("gldas", "gpm", "both"), default="both")
    args = parser.parse_args()

    ingest.login()  # raises RuntimeError with guidance when netrc auth fails

    keys = ("gldas", "gpm") if args.product == "both" else (args.product,)
    product_summaries = {}
    for key in keys:
        product_summaries[key] = download_product(key)

    coverage = coverage_check()

    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "products": product_summaries,
        "coverage_check": coverage,
    }
    SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    SUMMARY_PATH.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\nSummary written to {SUMMARY_PATH}", flush=True)

    for key, record in product_summaries.items():
        print(f"{key}: downloaded={record['downloaded']} "
              f"skipped={record['skipped']} failed={record['failed']}", flush=True)

    complete = all(
        cov["months_on_disk"] == cov["expected"] and not cov["extra"]
        for cov_key, cov in coverage.items()
        if cov_key in keys
    )
    if not complete:
        print("RESULT: INCOMPLETE - gaps reported above; never fill a gap "
              "manually, re-run to resume.", flush=True)
        return 1
    print("RESULT: COMPLETE - 288 months on disk for every requested product.",
          flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
