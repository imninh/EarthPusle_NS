"""P24 T1 tests: the catalog must match the files, not memory.

The probe reads one raw file per product. These tests guard the generated
``config/catalog.yaml`` against typos in units, long names and ids.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import xarray as xr
import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = PROJECT_ROOT / "config" / "catalog.yaml"

PRODUCT_FILES = {
    "GLDAS_NOAH10_M": PROJECT_ROOT / "data" / "raw" / "gldas" / "GLDAS_NOAH10_M.A200101.021.nc4",
    "M2TMNXSLV": PROJECT_ROOT / "data" / "raw" / "witness" / "M2TMNXSLV" / "MERRA2_300.tavgM_2d_slv_Nx.200101.nc4",
    "M2TMNXLND": PROJECT_ROOT / "data" / "raw" / "witness" / "M2TMNXLND" / "MERRA2_300.tavgM_2d_lnd_Nx.200101.nc4",
}


@pytest.fixture(scope="module")
def catalog() -> dict:
    return yaml.safe_load(CATALOG_PATH.read_text(encoding="utf-8"))


@pytest.mark.parametrize("product", sorted(PRODUCT_FILES))
def test_units_and_long_name_equal_file_attributes(catalog: dict, product: str) -> None:
    fields = [item for item in catalog["fields"] if item["product"] == product]
    assert fields, f"no catalog fields for {product}"
    with xr.open_dataset(PRODUCT_FILES[product], engine="netcdf4", decode_times=False, mask_and_scale=False) as ds:
        for item in fields:
            source = item["source_variable"]
            assert source in ds.variables, f"{source} missing from {PRODUCT_FILES[product].name}"
            assert item["units"] == ds[source].attrs["units"], source
            assert item["long_name"] == ds[source].attrs["long_name"], source


def test_ids_are_unique_and_pilot_is_the_four_atmosphere_variables(catalog: dict) -> None:
    ids = [item["id"] for item in catalog["fields"]]
    assert len(ids) == len(set(ids))
    deep = [item for item in catalog["fields"] if item["tier"] == "deep"]
    assert {item["id"] for item in deep} == {
        "air_temperature_850hpa",
        "air_temperature_500hpa",
        "column_water_vapor",
        "total_ozone",
    }
    for item in deep:
        assert item["product"] == "M2TMNXSLV"
        assert item["category"] in {"temperature", "atmosphere"}
        assert item["description"].endswith(".")
        assert item["increase_means"]


def test_every_exclusion_has_a_reason(catalog: dict) -> None:
    assert catalog["excluded"]
    for item in catalog["excluded"]:
        assert item["reason"].strip()
        assert item["product"] in PRODUCT_FILES


def test_valid_mask_share_is_a_fraction(catalog: dict) -> None:
    for item in catalog["fields"]:
        share = item["valid_mask_share"]
        assert share is None or 0.0 <= share <= 1.0, item["id"]


def test_pressure_levels_carry_a_below_ground_rule(catalog: dict) -> None:
    by_source = {item["source_variable"]: item for item in catalog["fields"]}
    assert by_source["T850"]["mask_below_ground_hpa"] == 850
    assert by_source["T500"]["mask_below_ground_hpa"] == 500
    assert by_source["T250"]["mask_below_ground_hpa"] == 250
    assert by_source["Q850"]["mask_below_ground_hpa"] == 850
    assert by_source["PS"].get("mask_below_ground_hpa") is None


def test_catalog_covers_every_non_variance_field(catalog: dict) -> None:
    total = len(catalog["fields"]) + len(catalog["excluded"])
    assert total >= 200
    assert len(catalog["fields"]) >= 100
    assert catalog["counts"]["candidates"] == len(catalog["fields"])
    assert catalog["counts"]["excluded"] == len(catalog["excluded"])
