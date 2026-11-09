"""Validate the P01 metadata manifest without network access.

These tests check the structure required by
``docs/packages/specs/P01_data_ingestion_metadata.md`` section 7. They deliberately
do not contact CMR or Earthdata and do not re-download data.

Run with:
    .venv/Scripts/python -m pytest
"""

from __future__ import annotations

import csv
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "data" / "metadata" / "manifest.json"
INVENTORY_PATH = ROOT / "data" / "metadata" / "variable_inventory.csv"

SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")

EXPECTED_CANDIDATES = {
    "surface_skin_temperature",
    "root_zone_soil_moisture",
    "near_surface_air_temperature",
    "surface_soil_moisture",
    "evapotranspiration",
    "surface_runoff",
    "snow_water_equivalent",
    "specific_humidity",
    "precipitation",
}

PRODUCT_FIELDS = {
    "short_name",
    "version",
    "concept_id",
    "doi",
    "title",
    "temporal_coverage",
    "granules_2001_2024",
    "documentation_url",
    "access_date",
    "file_format",
    "open_with",
    "grid",
    "time",
    "samples",
}

CANDIDATE_FIELDS = {
    "registry_concept",
    "product",
    "expected_name",
    "found_name",
    "status",
    "units",
    "semantic_type",
    "evidence",
    "fill_value",
    "sanity",
}


@pytest.fixture(scope="module")
def manifest() -> dict[str, Any]:
    """Load the generated manifest once for all tests."""

    assert MANIFEST_PATH.is_file(), f"Missing manifest: {MANIFEST_PATH}"
    data = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    return data


def test_top_level_schema(manifest: dict[str, Any]) -> None:
    """The manifest has the required top-level sections and a valid timestamp."""

    assert {"generated_at", "products", "candidates"} <= set(manifest)
    datetime.fromisoformat(manifest["generated_at"])
    assert manifest["products"], "manifest must contain at least one product"
    assert manifest["candidates"], "manifest must contain candidate variables"


def test_products_have_required_fields(manifest: dict[str, Any]) -> None:
    """Every product records the T1/T3 facts with defensible types."""

    for product in manifest["products"]:
        missing = PRODUCT_FIELDS - set(product)
        assert not missing, f"{product.get('short_name')} missing {missing}"

        assert isinstance(product["short_name"], str) and product["short_name"]
        assert isinstance(product["version"], str) and product["version"]
        assert isinstance(product["concept_id"], str) and product["concept_id"]
        assert product["doi"] is None or isinstance(product["doi"], str)

        coverage = product["temporal_coverage"]
        assert set(coverage) == {"start", "end"}
        assert coverage["start"] is None or isinstance(coverage["start"], str)

        assert isinstance(product["granules_2001_2024"], int)
        assert product["granules_2001_2024"] >= 0
        assert product["documentation_url"] is None or product[
            "documentation_url"
        ].startswith("https://")

        assert product["file_format"] in {"netCDF4", "HDF5"}
        open_with = product["open_with"]
        assert isinstance(open_with.get("engine"), str) and open_with["engine"]
        assert "group" in open_with

        grid = product["grid"]
        assert grid["lat_order"] in {"ascending", "descending"}
        assert grid["lon_range"] in {"-180..180", "0..360"}
        assert isinstance(grid["resolution_deg"], (int, float))
        assert grid["resolution_deg"] > 0
        for extent_name in ("lat_extent", "lon_extent"):
            extent = grid[extent_name]
            assert isinstance(extent, list) and len(extent) == 2
            assert all(isinstance(value, (int, float)) for value in extent)

        time = product["time"]
        assert {"raw", "units", "decoded", "represents"} <= set(time)
        assert time["units"]
        assert time["decoded"]

        assert product["samples"], "each product must have at least one sample"


def test_samples_have_checksums(manifest: dict[str, Any]) -> None:
    """Every sample records a 64-character SHA-256 and a positive size."""

    for product in manifest["products"]:
        for sample in product["samples"]:
            assert isinstance(sample.get("file"), str) and sample["file"]
            assert isinstance(sample.get("granule_url"), str)
            assert sample["granule_url"].startswith("https://")
            assert isinstance(sample.get("size_bytes"), int)
            assert sample["size_bytes"] > 0
            assert SHA256_PATTERN.match(sample.get("sha256", "")), sample["file"]
            assert isinstance(sample["inspection"], dict)
            assert sample["inspection"]["open_with"] == product["open_with"]


def test_all_candidate_concepts_present(manifest: dict[str, Any]) -> None:
    """Every candidate from plan section 3.7 has one record."""

    concepts = [entry["registry_concept"] for entry in manifest["candidates"]]
    assert len(concepts) == len(set(concepts)), "duplicate candidate records"
    assert EXPECTED_CANDIDATES <= set(concepts)


def test_candidates_have_status_and_evidence(manifest: dict[str, Any]) -> None:
    """Candidates use valid statuses; verified entries have units and semantics."""

    for candidate in manifest["candidates"]:
        missing = CANDIDATE_FIELDS - set(candidate)
        assert not missing, (
            f"{candidate.get('registry_concept')} missing {missing}"
        )

        status = candidate["status"]
        assert status in {"verified", "mismatch", "unknown"}
        assert candidate["semantic_type"] in {
            "state",
            "rate",
            "accumulation",
            "unknown",
        }
        assert isinstance(candidate["evidence"], str)

        if status == "verified":
            assert candidate["found_name"] == candidate["expected_name"]
            assert isinstance(candidate["units"], str) and candidate["units"]
            assert candidate["semantic_type"] != "unknown"
            assert candidate["evidence"].strip()
        elif status == "mismatch":
            assert candidate["found_name"] is not None
            assert candidate["found_name"] != candidate["expected_name"]
        else:
            assert candidate["semantic_type"] in {"state", "rate", "accumulation", "unknown"}


def test_candidate_sanity_statistics(manifest: dict[str, Any]) -> None:
    """Each candidate carries coherent pooled sanity statistics."""

    for candidate in manifest["candidates"]:
        sanity = candidate["sanity"]
        assert set(
            {"valid_cells", "total_cells", "min", "max", "mean", "fill_fraction"}
        ) <= set(sanity)
        assert isinstance(sanity["valid_cells"], int)
        assert isinstance(sanity["total_cells"], int)
        assert 0 <= sanity["valid_cells"] <= sanity["total_cells"]
        if sanity["total_cells"]:
            assert sanity["fill_fraction"] is not None
            assert 0.0 <= sanity["fill_fraction"] <= 1.0
        if sanity["valid_cells"]:
            assert sanity["min"] is not None
            assert sanity["max"] is not None
            assert sanity["mean"] is not None
            assert sanity["min"] <= sanity["mean"] <= sanity["max"]
        assert isinstance(candidate["sanity_by_sample"], list)
        assert isinstance(candidate.get("sanity_warnings", []), list)


def test_one_degree_gldas_check_is_recorded(manifest: dict[str, Any]) -> None:
    """The check-only GLDAS 1-degree product is recorded with a sample."""

    matches = [
        product
        for product in manifest["products"]
        if product["short_name"] == "GLDAS_NOAH10_M"
    ]
    assert matches, "GLDAS_NOAH10_M existence check is missing"
    product = matches[0]
    assert product.get("check_only") is True
    assert product["samples"], "the 1-degree check must include a downloaded sample"
    assert product["grid"]["resolution_deg"] == 1.0


def test_variable_inventory_exists(manifest: dict[str, Any]) -> None:
    """The T4 CSV exists and every verified candidate appears in it."""

    assert INVENTORY_PATH.is_file(), f"Missing inventory: {INVENTORY_PATH}"
    with INVENTORY_PATH.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))

    assert rows, "inventory must not be empty"
    required_columns = {
        "product",
        "sample_file",
        "variable",
        "units",
        "dimensions",
        "dtype",
        "fill_value",
        "semantic_type",
    }
    assert required_columns <= set(rows[0])

    for candidate in manifest["candidates"]:
        if candidate["status"] != "verified":
            continue
        matching = [
            row
            for row in rows
            if row["product"] == candidate["product"]
            and row["variable"] == candidate["found_name"]
        ]
        assert matching, (
            f"{candidate['registry_concept']} ({candidate['found_name']}) "
            "is verified but missing from variable_inventory.csv"
        )
