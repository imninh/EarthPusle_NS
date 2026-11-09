"""Export real P02/P03/P03b outputs to the EarthPulse web data contract.

Writes ``data/export/web_data/`` by default. It never writes directly into
``web/public/data``; use ``--publish`` after reviewing the export.

Examples:
    .venv/Scripts/python scripts/p_export.py
    .venv/Scripts/python scripts/p_export.py --windows 2001-2012
    .venv/Scripts/python scripts/p_export.py --publish   # explicit opt-in
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from earthpulse.export import (
    ANOMALY_DIR,
    CORRELATIONS_DIR,
    EXPORT_DIR,
    INTERIM_DIR,
    REGIONS_PATH,
    REGISTRY_PATH,
    TRENDS_DIR,
    export_all,
    publish_export,
    validate_export,
)


def _megabytes(byte_count: int) -> float:
    return byte_count / (1024.0 * 1024.0)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=EXPORT_DIR)
    parser.add_argument("--registry", type=Path, default=REGISTRY_PATH)
    parser.add_argument("--regions-config", type=Path, default=REGIONS_PATH)
    parser.add_argument("--country-geojson", type=Path, default=None)
    parser.add_argument("--interim-dir", type=Path, default=INTERIM_DIR)
    parser.add_argument("--anomaly-dir", type=Path, default=ANOMALY_DIR)
    parser.add_argument("--trends-dir", type=Path, default=TRENDS_DIR)
    parser.add_argument("--correlations-dir", type=Path, default=CORRELATIONS_DIR)
    parser.add_argument("--mask", type=Path, default=None)
    parser.add_argument(
        "--variables",
        nargs="+",
        default=None,
        help="optional subset of verified variable ids (default: all)",
    )
    parser.add_argument(
        "--windows",
        nargs="+",
        default=None,
        help="optional subset of contract window ids (default: all)",
    )
    parser.add_argument(
        "--regions",
        nargs="+",
        default=None,
        help="optional subset of region ids (default: all in config)",
    )
    parser.add_argument(
        "--correlation-pairs",
        nargs="+",
        default=None,
        help="optional pair ids; default: discover all pairs P03 produced",
    )
    parser.add_argument(
        "--publish",
        action="store_true",
        help="copy the validated export into web/public/data (do not use blindly)",
    )
    parser.add_argument(
        "--publish-only",
        action="store_true",
        help="validate an existing --out folder with --release and publish it; do not export",
    )
    parser.add_argument(
        "--no-validate",
        action="store_true",
        help="skip the post-export validator (the publish step still validates)",
    )
    args = parser.parse_args(argv)

    started = time.perf_counter()
    if args.publish_only:
        try:
            publish_export(args.out, release=True)
        except Exception as exc:  # noqa: BLE001 - CLI boundary
            print(f"PUBLISH FAILED: {exc}", file=sys.stderr)
            return 1
        print(f"Published validated export from {args.out} to web/public/data")
        print(f"Total wall time: {time.perf_counter() - started:.1f} s")
        return 0

    try:
        summary = export_all(
            args.out,
            registry_path=args.registry,
            regions_path=args.regions_config,
            country_geojson_path=args.country_geojson,
            interim_dir=args.interim_dir,
            anomaly_dir=args.anomaly_dir,
            trends_dir=args.trends_dir,
            correlations_dir=args.correlations_dir,
            mask_path=args.mask,
            variable_ids=args.variables,
            window_ids=args.windows,
            region_ids=args.regions,
            correlation_pairs=args.correlation_pairs,
        )
    except Exception as exc:  # noqa: BLE001 - CLI reports the actionable message
        print(f"EXPORT FAILED: {exc}", file=sys.stderr)
        return 1

    print(f"Export written to {summary['out_dir']}")
    print(
        f"Variables: {len(summary['variables'])}, windows: {len(summary['windows'])}, "
        f"regions: {len(summary['regions'])}, countries: {len(summary['countries'])}, "
        f"correlation pairs: {len(summary['correlation_pairs'])}, "
        f"tiles: {summary['tiles']}, mask cells: {summary['mask_cells']}"
    )
    print(
        f"Files: {summary['files']}, size: {_megabytes(summary['bytes']):.1f} MB, "
        f"export time: {summary['elapsed_seconds']:.1f} s"
    )

    if not args.no_validate:
        validation = validate_export(args.out, release=False)
        if validation["ok"]:
            print(
                f"Validation: PASS ({validation['files']} files, "
                f"{_megabytes(validation['bytes']):.1f} MB, "
                f"synthetic={validation['synthetic']})"
            )
        else:
            print(
                f"Validation: FAIL ({len(validation['errors'])} errors)",
                file=sys.stderr,
            )
            for error in validation["errors"]:
                print(f"- {error}", file=sys.stderr)
            return 1

    if args.publish:
        try:
            publish_export(args.out, release=True)
        except Exception as exc:  # noqa: BLE001 - CLI boundary
            print(f"PUBLISH FAILED: {exc}", file=sys.stderr)
            return 1
        print("Published to web/public/data")

    print(f"Total wall time: {time.perf_counter() - started:.1f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
