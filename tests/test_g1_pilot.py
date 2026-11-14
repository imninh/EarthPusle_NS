"""G1 pilot (P24 T2): registry rows, regridding path and export rules for the four
MERRA-2 deep-tier variables. Tests that need raw files skip when they are absent."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import xarray as xr

from earthpulse import contract
from earthpulse.harmonize import find_raw_file, load_registry
from earthpulse.witness import area_weighted_regrid, build_overlap_weights

PILOT = {
    "air_temperature_850hpa": ("T850", "K", "degC", "kelvin_to_celsius"),
    "air_temperature_500hpa": ("T500", "K", "degC", "kelvin_to_celsius"),
    "column_water_vapor": ("TQV", "kg m-2", "kg m-2", "identity"),
    "total_ozone": ("TO3", "Dobsons", "DU", "identity"),
}
RAW = Path(__file__).resolve().parents[1] / "data" / "raw"


def _rows():
    registry = load_registry()
    return registry, {v["id"]: v for v in registry["variables"]}


def test_pilot_rows_in_registry():
    registry, rows = _rows()
    product = registry["products"]["M2TMNXSLV"]
    assert product["source_type"] == "reanalysis"
    assert product["doi"] == "10.5067/AP1B0BA5PD2K"
    assert product["regrid"] == "conservative"
    for vid, (src, native, display, conv) in PILOT.items():
        row = rows[vid]
        assert (row["source_variable"], row["native_unit"], row["display_unit"], row["conversion"]) == (
            src, native, display, conv)
        assert row["product"] == "M2TMNXSLV" and row["verified"] is True and row["core"] is False
        assert row["category"] == "atmosphere" and row["semantic_type"] == "state"
        assert any("No second witness" in c for c in row["caveats"])
    assert rows["air_temperature_850hpa"]["valid_where_min"] == {
        "source_variable": "PS", "value": 85000, "unit": "Pa"}
    assert "valid_where_min" not in rows["air_temperature_500hpa"]


def test_pilot_units_match_raw_file_attributes():
    _, rows = _rows()
    try:
        path = find_raw_file(RAW, "M2TMNXSLV", 2001, 1)
    except FileNotFoundError:
        pytest.skip("raw MERRA-2 file not on disk")
    with xr.open_dataset(path, decode_times=False, mask_and_scale=False) as ds:
        for vid in PILOT:
            row = rows[vid]
            attrs = ds[row["source_variable"]].attrs
            assert attrs["units"] == row["native_unit"]
            assert attrs["long_name"] == row["source_long_name"]


def test_pilot_variables_have_no_witness_registered():
    for vid in PILOT:
        assert vid not in contract.WITNESSES


def test_conservative_regrid_constant_and_missing():
    lat = np.arange(-90, 90.01, 0.5)
    lon = np.arange(-180, 180, 0.625)
    weights = build_overlap_weights(lat, lon)
    field = np.full((lat.size, lon.size), 280.0)
    out = area_weighted_regrid(field, weights, field.shape)
    assert np.allclose(out[np.isfinite(out)], 280.0)
    below = field.copy()
    below[:, : lon.size // 2] = np.nan  # half the globe masked (as PS < 85000 Pa would)
    out2 = area_weighted_regrid(below, weights, below.shape)
    assert np.isnan(out2[:, :150]).all() and np.isfinite(out2[:, 215:]).all()


def test_harmonized_t850_is_celsius_and_pressure_masked():
    root = Path(__file__).resolve().parents[1] / "data" / "interim" / "harmonized_monthly"
    t850_path = root / "air_temperature_850hpa.nc"
    t500_path = root / "air_temperature_500hpa.nc"
    if not (t850_path.is_file() and t500_path.is_file()):
        pytest.skip("harmonized pilot cubes not on disk")
    with xr.open_dataset(t850_path) as ds:
        t850 = np.asarray(ds["air_temperature_850hpa"].values)
    with xr.open_dataset(t500_path) as ds:
        t500 = np.asarray(ds["air_temperature_500hpa"].values)
    valid = np.isfinite(t850)
    assert valid.any()
    # Kelvin values would be ~240-310; the harmonized cube must be degC.
    assert -100.0 < np.nanmin(t850) < 60.0
    assert np.nanmax(t850) < 60.0
    # The PS < 85000 Pa rule can only remove cells from the unmasked T500 field.
    assert np.all(valid <= np.isfinite(t500))


def test_exported_pilot_has_no_witness_files():
    root = Path(__file__).resolve().parents[1] / "data" / "export" / "web_data"
    if not (root / "index.json").is_file():
        pytest.skip("no export on disk")
    import json
    index = json.loads((root / "index.json").read_text(encoding="utf-8"))
    ids = {v["id"] for v in index["variables"]}
    if not set(PILOT) <= ids:
        pytest.skip("export predates the pilot")
    for vid in PILOT:
        assert vid not in index["witness"]["products"]
        for window in contract.WINDOWS:
            folder = root / "grids" / vid / window
            assert not (folder / "witness_agreement.i8").exists()
            flags = np.fromfile(folder / "quality_flag.i8", dtype="i1")
            assert not (flags == contract.QUALITY_STEP_KNOWN_FORCING).any()
        series = json.loads(
            (root / "series" / "regions" / "global" / f"{vid}.json").read_text(encoding="utf-8")
        ) if (root / "series" / "regions" / "global").exists() else {}
        assert "witness_anomalies" not in series
