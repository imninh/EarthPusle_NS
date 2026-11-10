#!/usr/bin/env python
"""P13 T1: download the three independent witness products, 2001-01..2024-12.

Usage:
    .venv/Scripts/python scripts/p13_download.py [--product M2TMNXSLV ...]

Resumable: an existing file is kept when its size matches the CMR-reported
size (within 1%). The script searches CMR for all granules, downloads missing
files in batches, retries failures, and writes a 288-month coverage report to
``data/raw/witness/download_summary.json``.

Credentials come from the user's existing netrc file; they are never printed.
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
import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from earthpulse import ingest  # noqa: E402

CONFIG_PATH = PROJECT_ROOT / "config" / "witnesses.yaml"
RAW_ROOT = PROJECT_ROOT / "data" / "raw" / "witness"
SUMMARY_PATH = RAW_ROOT / "download_summary.json"
EXPECTED_MONTHS = [(year, month) for year in range(2001, 2025) for month in range(1, 13)]
MAX_ATTEMPTS = 3
RETRY_SLEEP_S = 10
SIZE_TOLERANCE = 0.01
DOWNLOAD_THREADS = 8


def month_key(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def month_from_granule(granule: dict, file_name: str) -> tuple[int, int] | None:
    """Month from CMR temporal metadata, falling back to the file name."""
    umm = granule.get("umm", {})
    for path in (
        ("TemporalExtent", "RangeDateTime", "BeginningDateTime"),
        ("TemporalExtents", "RangeDateTimes", "BeginningDateTime"),
    ):
        node: object = umm
        try:
            for key in path:
                node = node[key]
            parsed = datetime.fromisoformat(str(node).replace("Z", "+00:00"))
            return parsed.year, parsed.month
        except (KeyError, IndexError, TypeError, ValueError):
            continue
    match = re.search(r"\.(\d{4})(\d{2})\.nc4$", file_name)
    if match:
        return int(match.group(1)), int(match.group(2))
    match = re.search(r"_L3_(\d{4})(\d{2})_", file_name)
    if match:
        return int(match.group(1)), int(match.group(2))
    return None


def size_matches(existing: Path, size_mb: float | None) -> bool:
    if not existing.exists():
        return False
    if size_mb is None or size_mb <= 0:
        return True
    expected = float(size_mb) * 1_000_000.0
    return abs(existing.stat().st_size - expected) / expected <= SIZE_TOLERANCE


def download_product(
    product_name: str, product_cfg: dict
) -> dict:
    short_name = product_cfg["short_name"]
    version = str(product_cfg["version"])
    out_dir = RAW_ROOT / product_cfg["raw_subdir"]
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"\n=== {short_name} v{version} ===", flush=True)

    granules = earthaccess.search_data(
        short_name=short_name,
        version=version,
        temporal=("2001-01-01", "2024-12-31"),
    )
    print(f"CMR granules: {len(granules)} (expected {len(EXPECTED_MONTHS)})", flush=True)

    by_month: dict[tuple[int, int], dict] = {}
    for granule in granules:
        record = ingest.granule_record(granule)
        key = month_from_granule(granule, record["granule_name"])
        if key is None:
            print(f"  WARNING: cannot date {record['granule_name']}", flush=True)
            continue
        by_month.setdefault(key, {"granule": granule, "record": record})

    summary = {
        "product": short_name,
        "version": version,
        "expected_months": len(EXPECTED_MONTHS),
        "granules_found": len(granules),
        "downloaded": 0,
        "skipped": 0,
        "failed": 0,
        "missing_months": [],
        "failed_months": [],
    }

    pending: list[dict] = []
    for year, month in EXPECTED_MONTHS:
        entry = by_month.get((year, month))
        label = month_key(year, month)
        if entry is None:
            summary["missing_months"].append(label)
            summary["failed"] += 1
            continue
        destination = out_dir / entry["record"]["granule_name"]
        if size_matches(destination, entry["record"].get("size_mb")):
            summary["skipped"] += 1
            continue
        pending.append(entry)

    if pending:
        print(f"  downloading {len(pending)} missing months...", flush=True)
        try:
            earthaccess.download(
                [entry["granule"] for entry in pending],
                local_path=str(out_dir),
                threads=DOWNLOAD_THREADS,
                show_progress=False,
            )
        except Exception as exc:  # noqa: BLE001 - per-file retry below
            print(f"  batch download problem: {exc}", flush=True)

    for entry in pending:
        record = entry["record"]
        destination = out_dir / record["granule_name"]
        if size_matches(destination, record.get("size_mb")):
            summary["downloaded"] += 1
            continue
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                produced = earthaccess.download(
                    [entry["granule"]],
                    local_path=str(out_dir),
                    show_progress=False,
                )
                if not produced:
                    raise RuntimeError("download returned no path")
                path = Path(produced[0])
                if path.resolve() != destination.resolve() and path.exists():
                    path.replace(destination)
                if not destination.exists():
                    raise RuntimeError("file missing after download")
                summary["downloaded"] += 1
                break
            except Exception as exc:  # noqa: BLE001
                print(
                    f"  {destination.name}: attempt {attempt} failed ({exc})",
                    flush=True,
                )
                if attempt < MAX_ATTEMPTS:
                    time.sleep(RETRY_SLEEP_S)
        else:
            summary["failed"] += 1
            summary["failed_months"].append(
                month_key(*month_from_granule(entry["granule"], record["granule_name"]))
            )

    summary["finished_at"] = datetime.now(timezone.utc).isoformat()
    print(
        f"  {short_name}: downloaded={summary['downloaded']} "
        f"skipped={summary['skipped']} failed={summary['failed']}",
        flush=True,
    )
    return summary


def coverage_check(product_cfg: dict) -> dict:
    out_dir = RAW_ROOT / product_cfg["raw_subdir"]
    found: set[tuple[int, int]] = set()
    if out_dir.is_dir():
        for path in out_dir.glob("*"):
            if not path.is_file():
                continue
            key = month_from_granule({}, path.name)
            if key is not None:
                found.add(key)
    missing = [month_key(*month) for month in EXPECTED_MONTHS if month not in found]
    extra = sorted(month_key(*m) for m in found if m not in set(EXPECTED_MONTHS))
    result = {
        "months_on_disk": len(found),
        "expected": len(EXPECTED_MONTHS),
        "missing": missing,
        "extra": extra,
    }
    print(
        f"{product_cfg['short_name']}: {len(found)}/{len(EXPECTED_MONTHS)} "
        f"months on disk {'OK' if not missing and not extra else 'GAPS'}",
        flush=True,
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--product",
        action="append",
        default=None,
        help="product short name to download (default: all in config)",
    )
    args = parser.parse_args()

    config = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))
    products = config["products"]
    requested = args.product or list(products)
    unknown = [name for name in requested if name not in products]
    if unknown:
        print(f"Unknown product(s): {unknown}", file=sys.stderr)
        return 2

    ingest.login()
    RAW_ROOT.mkdir(parents=True, exist_ok=True)
    started = datetime.now(timezone.utc).isoformat()

    summaries = {}
    for name in requested:
        summaries[name] = download_product(name, products[name])

    coverage = {name: coverage_check(products[name]) for name in requested}
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "started_at": started,
        "products": summaries,
        "coverage_check": coverage,
    }
    SUMMARY_PATH.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\nCoverage summary written to {SUMMARY_PATH}", flush=True)

    complete = all(
        item["months_on_disk"] == item["expected"] and not item["extra"]
        for item in coverage.values()
    )
    if not complete:
        print("RESULT: INCOMPLETE - re-run to resume; gaps are not filled.", flush=True)
        return 1
    print("RESULT: COMPLETE - 288 months per product.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
