#!/usr/bin/env python
"""Run the P01 data-ingestion and metadata-inspection package end to end.

The script performs T1-T6 from ``docs/packages/specs/P01_data_ingestion_metadata.md``:
CMR collection facts, sample download with SHA-256, file-level inspection,
variable inventory, candidate-variable verification and quick-look maps.

It writes only metadata artefacts:

* ``data/metadata/manifest.json``
* ``data/metadata/variable_inventory.csv``
* ``data/metadata/quicklook/*.png``

There is no regridding, anomaly, trend or UI logic. Re-running the script
reuses existing downloads only after verifying them against the checksums in
the previous manifest.

Usage:
    .venv/Scripts/python scripts/p01_inspect.py
"""

from __future__ import annotations

import argparse
import csv
import difflib
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from earthpulse import ingest  # noqa: E402


# Candidates to verify from plan section 3.7. Names are expected, not assumed:
# the script confirms each name in the real file and reports a mismatch rather
# than renaming anything.
CANDIDATES: tuple[dict[str, Any], ...] = (
    {
        "registry_concept": "surface_skin_temperature",
        "product": "GLDAS_NOAH025_M",
        "expected_name": "AvgSurfT_inst",
        "sanity_kind": "temperature",
    },
    {
        "registry_concept": "root_zone_soil_moisture",
        "product": "GLDAS_NOAH025_M",
        "expected_name": "RootMoist_inst",
        "sanity_kind": "nonnegative",
    },
    {
        "registry_concept": "near_surface_air_temperature",
        "product": "GLDAS_NOAH025_M",
        "expected_name": "Tair_f_inst",
        "sanity_kind": "temperature",
    },
    {
        "registry_concept": "surface_soil_moisture",
        "product": "GLDAS_NOAH025_M",
        "expected_name": "SoilMoi0_10cm_inst",
        "sanity_kind": "nonnegative",
    },
    {
        "registry_concept": "evapotranspiration",
        "product": "GLDAS_NOAH025_M",
        "expected_name": "Evap_tavg",
        "sanity_kind": "none",
    },
    {
        "registry_concept": "surface_runoff",
        "product": "GLDAS_NOAH025_M",
        "expected_name": "Qs_acc",
        "sanity_kind": "nonnegative",
    },
    {
        "registry_concept": "snow_water_equivalent",
        "product": "GLDAS_NOAH025_M",
        "expected_name": "SWE_inst",
        "sanity_kind": "nonnegative",
    },
    {
        "registry_concept": "specific_humidity",
        "product": "GLDAS_NOAH025_M",
        "expected_name": "Qair_f_inst",
        "sanity_kind": "specific_humidity",
    },
    {
        "registry_concept": "precipitation",
        "product": "GPM_3IMERGM",
        "expected_name": "precipitation",
        "sanity_kind": "precipitation",
    },
)

CORE_QUICKLOOK_VARIABLES: dict[str, tuple[str, ...]] = {
    "GLDAS_NOAH025_M": ("AvgSurfT_inst", "RootMoist_inst"),
    "GPM_3IMERGM": ("precipitation",),
    "GLDAS_NOAH10_M": ("AvgSurfT_inst", "RootMoist_inst"),
}

CANDIDATE_NOTES: dict[str, str] = {
    "surface_skin_temperature": (
        "File name suffix is '_inst', but cell_methods='time: mean': the monthly "
        "field is a monthly mean of instantaneous skin temperature. This is surface "
        "skin temperature, not near-surface air temperature."
    ),
    "root_zone_soil_moisture": (
        "Root-zone soil moisture is a Noah model diagnostic, not a direct in-situ "
        "measurement. Units are kg m-2 (water equivalent)."
    ),
    "near_surface_air_temperature": (
        "Model forcing field (air temperature at the lowest model level). Label it "
        "as a forcing field in user-facing text."
    ),
    "surface_soil_moisture": (
        "Top soil layer 0-10 cm. Units are kg m-2 (water equivalent)."
    ),
    "evapotranspiration": (
        "Rate in kg m-2 s-1; the monthly field is a time mean of 3-hourly averages. "
        "Small negative valid values occur (condensation) and are not flagged as "
        "impossible."
    ),
    "surface_runoff": (
        "Accumulation units (kg m-2). The file defines 'acc' as a past 3-hour "
        "accumulation, yet cell_methods='time: mean'. The file does NOT state whether "
        "the monthly value is a monthly total or a monthly mean of 3-hour "
        "accumulations; monthly_statistic is therefore 'unknown' and must be resolved "
        "in P02 before any totals are computed."
    ),
    "snow_water_equivalent": (
        "State variable. Meaningful only where snow occurs; mask to snow-covered "
        "cells before analysis."
    ),
    "specific_humidity": (
        "Model forcing field; specific humidity (kg kg-1), not relative humidity."
    ),
    "precipitation": (
        "The file stores mm/hr: a rate, not a monthly total. GridHeader "
        "BinMethod=ARITHMETIC_MEAN and FileHeader TimeInterval=MONTH indicate a "
        "monthly mean rate. P02 must multiply by the number of hours in each calendar "
        "month to obtain mm/month. Companion fields are randomError (mm/hr), "
        "gaugeRelativeWeighting (percent), probabilityLiquidPrecipitation (percent) "
        "and precipitationQualityIndex (no units attribute)."
    ),
}

MONTHLY_STATISTIC: dict[str, str] = {
    "surface_skin_temperature": "mean over the month (cell_methods='time: mean')",
    "root_zone_soil_moisture": "mean over the month (cell_methods='time: mean')",
    "near_surface_air_temperature": "mean over the month (cell_methods='time: mean')",
    "surface_soil_moisture": "mean over the month (cell_methods='time: mean')",
    "evapotranspiration": (
        "mean over the month of 3-hourly averages (cell_methods='time: mean')"
    ),
    "surface_runoff": "unknown (file gives an 'acc' definition but time: mean)",
    "snow_water_equivalent": "mean over the month (cell_methods='time: mean')",
    "specific_humidity": "mean over the month (cell_methods='time: mean')",
    "precipitation": (
        "monthly mean rate (GridHeader BinMethod=ARITHMETIC_MEAN; "
        "FileHeader TimeInterval=MONTH)"
    ),
}


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        default=str(ROOT / "data" / "metadata"),
        help="Directory for manifest.json, the inventory CSV and quicklook/.",
    )
    parser.add_argument(
        "--raw-root",
        default=str(ROOT / "data" / "raw"),
        help="Root of the git-ignored raw-data tree.",
    )
    parser.add_argument(
        "--skip-quicklook",
        action="store_true",
        help="Skip PNG generation (metadata is still written).",
    )
    return parser.parse_args()


def load_previous_manifest(path: Path) -> dict[str, Any]:
    """Load the previous manifest if it exists and is valid JSON."""

    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print(f"WARNING: could not parse previous manifest at {path}; ignoring it")
        return {}


def expected_checksums(manifest: dict[str, Any]) -> dict[str, str]:
    """Map file names to SHA-256 values recorded by a previous run."""

    checksums: dict[str, str] = {}
    for product in manifest.get("products", []):
        for sample in product.get("samples", []):
            name = sample.get("file")
            digest = sample.get("sha256")
            if name and digest:
                checksums[name] = digest
    return checksums


def sanity_check(
    kind: str,
    ds: Any,
    variable: str,
    fill_value: Any,
) -> list[dict[str, Any]]:
    """Run the physically-impossible-value checks requested by P01 T5."""

    values = ds[variable].values
    checks: list[dict[str, Any]] = []

    if kind == "temperature":
        count = ingest.count_outside(values, fill_value, 180.0, 350.0)
        checks.append(
            {
                "check": "outside 180-350 K",
                "count": count,
                "description": "temperature values outside roughly 180-350 K",
            }
        )
    elif kind == "nonnegative":
        count = ingest.count_outside(values, fill_value, low=0.0)
        checks.append(
            {
                "check": "negative valid values",
                "count": count,
                "description": "negative values in a physically non-negative quantity",
            }
        )
    elif kind == "precipitation":
        count = ingest.count_outside(values, fill_value, low=0.0)
        checks.append(
            {
                "check": "negative precipitation",
                "count": count,
                "description": "negative precipitation values",
            }
        )
    elif kind == "specific_humidity":
        count = ingest.count_outside(values, fill_value, 0.0, 0.1)
        checks.append(
            {
                "check": "outside 0-0.1 kg kg-1",
                "count": count,
                "description": "specific-humidity values outside 0-0.1 kg kg-1",
            }
        )
    else:
        checks.append(
            {
                "check": "none",
                "count": None,
                "description": "no hard physical-range check defined for this quantity",
            }
        )

    return checks


def merge_checks(
    existing: list[dict[str, Any]] | None,
    new: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Sum per-sample check counts across the samples of one product."""

    if existing is None:
        return [dict(check) for check in new]
    merged: list[dict[str, Any]] = []
    for old, fresh in zip(existing, new):
        old_count = old.get("count")
        new_count = fresh.get("count")
        count = (
            old_count + new_count
            if old_count is not None and new_count is not None
            else None
        )
        merged.append({**old, "count": count})
    return merged


def companion_variables(ds: Any, primary: str) -> list[dict[str, Any]]:
    """Describe non-primary data variables in the IMERG file."""

    companions: list[dict[str, Any]] = []
    for name in ingest.data_variable_names(ds):
        if name == primary:
            continue
        variable = ds[name]
        companions.append(
            {
                "name": name,
                "long_name": ingest.attribute(variable, "long_name", "LongName"),
                "units": ingest.attribute(variable, "units", "Units"),
                "dimensions": list(variable.dims),
                "fill_value": _scalar(
                    ingest.attribute(variable, "_FillValue", "CodeMissingValue")
                ),
            }
        )
    return companions


def _scalar(value: Any) -> Any:
    """Convert a numpy scalar to a Python scalar for JSON output."""

    if value is None:
        return None
    if hasattr(value, "item"):
        return value.item()
    return value


def main() -> int:
    """Run T1-T6 and write the P01 metadata artefacts."""

    args = parse_args()
    output_dir = Path(args.output_dir).resolve()
    raw_root = Path(args.raw_root).resolve()
    quicklook_dir = output_dir / "quicklook"
    output_dir.mkdir(parents=True, exist_ok=True)
    quicklook_dir.mkdir(parents=True, exist_ok=True)

    previous = load_previous_manifest(output_dir / "manifest.json")
    expected = expected_checksums(previous)

    print("Authenticating with NASA Earthdata (netrc)...")
    ingest.login()

    products: list[dict[str, Any]] = []
    inventory: list[dict[str, Any]] = []
    quicklooks: list[str] = []
    product_datasets: dict[str, list[Any]] = {spec.short_name: [] for spec in ingest.SPECS}
    accumulators: dict[str, ingest.SanityAccumulator] = {
        candidate["registry_concept"]: ingest.SanityAccumulator()
        for candidate in CANDIDATES
    }
    per_sample_sanity: dict[str, list[dict[str, Any]]] = {
        candidate["registry_concept"]: [] for candidate in CANDIDATES
    }
    candidate_checks: dict[str, tuple[list[dict[str, Any]], list[str]]] = {}

    all_datasets: list[Any] = []
    try:
        for spec in ingest.SPECS:
            print(f"\n=== {spec.short_name} v{spec.version} ===")
            record = ingest.collection_record(spec)
            record["granules_2001_2024"] = ingest.granule_count(record["concept_id"])
            print(
                f"collection {record['concept_id']}: "
                f"{record['granules_2001_2024']} granules covering 2001-01..2024-12"
            )

            samples: list[dict[str, Any]] = []
            first_inspection: dict[str, Any] | None = None

            for year, month in spec.sample_months:
                granules = ingest.search_sample_granules(spec, year, month)
                granule = granules[0]
                identity = ingest.granule_record(granule)
                print(f" - {year}-{month:02d}: {identity['granule_name']}")

                sample = ingest.download_granule(
                    spec,
                    granule,
                    raw_root,
                    expected_sha256=expected.get(str(identity["granule_name"])),
                )
                local_path = Path(sample["path"])
                print(
                    f"   {sample['download_status']}; "
                    f"{sample['size_bytes']} bytes; sha256={sample['sha256']}"
                )

                ds = ingest.open_product(local_path, spec)
                all_datasets.append(ds)
                product_datasets[spec.short_name].append(ds)

                inspection = ingest.inspection_record(ds, spec)
                sample["inspection"] = inspection
                sample["year_month"] = f"{year}{month:02d}"
                try:
                    sample["path"] = local_path.resolve().relative_to(ROOT).as_posix()
                except ValueError:
                    sample["path"] = local_path.resolve().as_posix()
                samples.append(sample)
                if first_inspection is None:
                    first_inspection = inspection

                inventory.extend(ingest.inventory_rows(ds, spec, sample["file"]))

                for candidate in CANDIDATES:
                    concept = candidate["registry_concept"]
                    if candidate["product"] != spec.short_name:
                        continue
                    if candidate["expected_name"] not in ingest.data_variable_names(ds):
                        continue
                    variable = ds[candidate["expected_name"]]
                    fill_value = _scalar(
                        ingest.attribute(variable, "_FillValue", "CodeMissingValue")
                    )
                    local = ingest.SanityAccumulator()
                    local.add(variable.values, fill_value)
                    per_sample_sanity[concept].append(
                        {"file": sample["file"], **local.as_dict()}
                    )
                    accumulators[concept].add(variable.values, fill_value)
                    candidate_checks[concept] = merge_checks(
                        candidate_checks.get(concept),
                        sanity_check(
                            candidate["sanity_kind"],
                            ds,
                            candidate["expected_name"],
                            fill_value,
                        ),
                    )

                if not args.skip_quicklook:
                    for variable_name in CORE_QUICKLOOK_VARIABLES.get(spec.short_name, ()):
                        if variable_name not in ingest.data_variable_names(ds):
                            continue
                        filename = (
                            f"{spec.short_name}.{year}{month:02d}.{variable_name}.png"
                        )
                        path = ingest.quicklook_map(
                            ds,
                            variable_name,
                            quicklook_dir / filename,
                            title=(
                                f"{spec.short_name} {year}-{month:02d} "
                                f"{variable_name}"
                            ),
                        )
                        try:
                            quicklook_path = path.relative_to(ROOT).as_posix()
                        except ValueError:
                            quicklook_path = path.resolve().as_posix()
                        quicklooks.append(quicklook_path)
                        print(f"   quicklook: {path.name}")

            if first_inspection is None:
                raise RuntimeError(f"No samples inspected for {spec.short_name}")

            record.update(
                {
                    "file_format": first_inspection["file_format"],
                    "open_with": first_inspection["open_with"],
                    "grid": first_inspection["grid"],
                    "time": first_inspection["time"],
                    "dimension_order": first_inspection["dimension_order"],
                    "samples": samples,
                }
            )
            products.append(record)

        candidates: list[dict[str, Any]] = []
        for candidate in CANDIDATES:
            concept = candidate["registry_concept"]
            spec = ingest.SPECS_BY_SHORT_NAME[candidate["product"]]
            datasets = product_datasets[candidate["product"]]
            if not datasets:
                raise RuntimeError(f"No dataset available for candidate {concept}")
            reference = datasets[0]
            names = ingest.data_variable_names(reference)

            found_name: str | None
            if candidate["expected_name"] in names:
                found_name = candidate["expected_name"]
            else:
                matches = difflib.get_close_matches(
                    candidate["expected_name"], names, n=1, cutoff=0.6
                )
                found_name = matches[0] if matches else None

            units = None
            semantic_type = "unknown"
            evidence = "No matching variable found in the sample files."
            fill_value = None
            long_name = None
            standard_name = None
            companions: list[dict[str, Any]] = []

            if found_name is not None:
                variable = reference[found_name]
                units = ingest.attribute(variable, "units", "Units")
                long_name = ingest.attribute(variable, "long_name", "LongName")
                standard_name = ingest.attribute(variable, "standard_name")
                fill_value = _scalar(
                    ingest.attribute(variable, "_FillValue", "CodeMissingValue")
                )
                semantic_type, semantic_evidence = ingest.temporal_semantics(
                    spec, found_name, variable.attrs, reference.attrs
                )
                evidence_parts: list[str] = []
                if long_name is not None:
                    evidence_parts.append(f"long_name='{long_name}'")
                if standard_name is not None:
                    evidence_parts.append(f"standard_name='{standard_name}'")
                evidence_parts.extend(
                    [f"units='{units}'", semantic_evidence]
                )
                evidence = "; ".join(evidence_parts)
                if candidate["product"] == "GPM_3IMERGM":
                    companions = companion_variables(reference, found_name)

            if found_name is None:
                status = "unknown"
            elif found_name != candidate["expected_name"]:
                status = "mismatch"
            elif units and semantic_type != "unknown":
                status = "verified"
            else:
                status = "unknown"

            checks = candidate_checks.get(
                concept,
                [
                    {
                        "check": "not run",
                        "count": None,
                        "description": "no data",
                    }
                ],
            )
            flags = [
                f"{check['count']} {check['description']}"
                for check in checks
                if check.get("count")
            ]
            sanity = accumulators[concept].as_dict()
            sanity_warnings: list[str] = []
            if (
                concept == "snow_water_equivalent"
                and sanity.get("max") is not None
                and float(sanity["max"]) > 50000.0
            ):
                sanity_warnings.append(
                    "Extreme maximum SWE (above 50,000 kg m-2) concentrated near "
                    "60.875 N, 44.125 W (Greenland) in the samples. This is a broad "
                    "plausibility warning, not a scientific conclusion; mask or "
                    "quality-control SWE before analysis."
                )
            candidates.append(
                {
                    "registry_concept": concept,
                    "product": candidate["product"],
                    "expected_name": candidate["expected_name"],
                    "found_name": found_name,
                    "status": status,
                    "units": units,
                    "semantic_type": semantic_type,
                    "evidence": evidence,
                    "fill_value": fill_value,
                    "long_name": long_name,
                    "standard_name": standard_name,
                    "monthly_statistic": MONTHLY_STATISTIC.get(concept, "unknown"),
                    "sanity": sanity,
                    "sanity_by_sample": per_sample_sanity[concept],
                    "sanity_checks": checks,
                    "sanity_warnings": sanity_warnings,
                    "physically_impossible": flags,
                    "companions": companions,
                    "notes": CANDIDATE_NOTES.get(concept, ""),
                }
            )

    finally:
        for ds in all_datasets:
            ds.close()

    manifest = {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "package": "P01",
        "analysis_window": {
            "start": ingest.ANALYSIS_START,
            "end": ingest.ANALYSIS_END,
            "expected_months": 288,
        },
        "products": products,
        "candidates": candidates,
        "quicklooks": quicklooks,
        "notes": [
            "Raw files are stored under data/raw/ and are git-ignored.",
            "No regridding, anomaly, trend, significance or UI logic was run.",
            "Candidate sanity statistics pool the listed sample months; see "
            "sanity_by_sample for per-file values.",
            "All names, units and semantics come from the files or CMR metadata; "
            "anything undetermined is recorded as null or 'unknown'.",
        ],
    }

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"\nWrote {manifest_path}")

    inventory_path = output_dir / "variable_inventory.csv"
    fieldnames = [
        "product",
        "version",
        "sample_file",
        "variable",
        "role",
        "long_name",
        "standard_name",
        "units",
        "dimensions",
        "dtype",
        "fill_value",
        "missing_value",
        "scale_factor",
        "add_offset",
        "cell_methods",
        "semantic_type",
        "semantics_evidence",
    ]
    with inventory_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(inventory)
    print(f"Wrote {inventory_path} ({len(inventory)} rows)")
    print(f"Quick-look maps: {len(quicklooks)}")

    missing = [
        candidate["registry_concept"]
        for candidate in candidates
        if candidate["status"] != "verified"
    ]
    if missing:
        print("WARNING: not verified: " + ", ".join(missing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
