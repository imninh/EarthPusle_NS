"""Validate an EarthPulse data folder against docs/DATA_CONTRACT.md.

Usage:
    .venv/Scripts/python scripts/validate_export.py <folder> [--release]

Exit code 0 only when every check passes. ``--release`` additionally fails if
any JSON file still carries ``"synthetic": true``.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from earthpulse.export import validate_export


def _megabytes(byte_count: int) -> float:
    return byte_count / (1024.0 * 1024.0)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument(
        "--release",
        action="store_true",
        help="fail when any JSON file has synthetic=true",
    )
    args = parser.parse_args(argv)

    result = validate_export(args.folder, release=args.release)
    if result["ok"]:
        print("VALIDATION PASSED")
    else:
        print(f"VALIDATION FAILED: {len(result['errors'])} error(s)")
        for error in result["errors"]:
            print(f"- {error}")

    synthetic = "yes" if result["synthetic"] else "no"
    print(f"Schema version: {result['schema_version']}")
    print(f"Synthetic flag present: {synthetic}")
    if result["synthetic_files"]:
        print("Synthetic JSON files:")
        for path in sorted(result["synthetic_files"]):
            print(f"- {path}")
    print(
        f"Files: {result['files']}, total size: "
        f"{_megabytes(result['bytes']):.1f} MB"
    )
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
