"""Tests for P-EXPORT using small synthetic NetCDF fixtures.

All fixture data are synthetic and live in pytest temporary directories. No
P02/P03 folder is written to. The test export is a subset (two variables, one
window) so the suite stays fast; the production CLI defaults to everything.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import xarray as xr
import yaml

from earthpulse import contract
from earthpulse.export import (
    EXPORT_SCHEMA_VERSION,
    TARGET_LAT,
    TARGET_LON,
    WEB_DATA_DIR,
    export_all,
    month_labels,
    publish_export,
    validate_export,
)
from earthpulse.screener import domain_mask

TEMPERATURE = "surface_skin_temperature"
MOISTURE = "root_zone_soil_moisture"
WINDOW = "2001-2024"
PAIR = f"{MOISTURE}__{TEMPERATURE}"
COUNTRY_ID = "country_001"

# Synthetic land patch: rows 60..69 (29.5N..20.5N), cols 185..195
# (5.5E..15.5E). The marker cell is row 66, col 192 = 23.5N, 12.5E.
MASK_ROWS = slice(60, 70)
MASK_COLS = slice(185, 196)
MARKER = (66, 192)
INSUFFICIENT = (60, 185)


def _dataset_grid() -> xr.Dataset:
    return xr.Dataset(
        coords={
            "lat": ("lat", TARGET_LAT, {"units": "degrees_north"}),
            "lon": ("lon", TARGET_LON, {"units": "degrees_east"}),
        }
    )


def _write_trend_file(path: Path, variable_id: str, mask: np.ndarray) -> None:
    shape = (contract.N_ROWS, contract.N_COLS)
    outside = ~mask
    base = {
        "sen_slope": np.full(shape, 0.1, dtype=float),
        "sen_slope_decade": np.full(shape, 1.0, dtype=float),
        "std_change_decade": np.full(shape, 0.5, dtype=float),
        "p_value": np.full(shape, 0.5, dtype=float),
        "p_value_original": np.full(shape, 0.5, dtype=float),
        "q_value": np.full(shape, 0.5, dtype=float),
        "mk_tau": np.full(shape, 0.1, dtype=float),
        "n_valid": np.full(shape, float(contract.N_MONTHS), dtype=float),
        "coverage": np.full(shape, 1.0, dtype=float),
    }
    classes = np.zeros(shape, dtype=np.int8)
    marker = np.zeros(shape, dtype=bool)
    marker[MARKER] = True
    insufficient = np.zeros(shape, dtype=bool)
    insufficient[INSUFFICIENT] = True

    for name in base:
        base[name][outside] = np.nan
        base[name][insufficient] = np.nan

    if variable_id == TEMPERATURE:
        base["sen_slope"][MARKER] = 1.0
        base["sen_slope_decade"][MARKER] = 10.0
        base["q_value"][MARKER] = 0.001
        classes[MARKER] = contract.TREND_INCREASE
    else:
        base["sen_slope"][MARKER] = -1.0
        base["sen_slope_decade"][MARKER] = -10.0
        base["q_value"][MARKER] = 0.001
        classes[MARKER] = contract.TREND_DECREASE

    classes[insufficient] = contract.INSUFFICIENT_DATA
    classes[outside] = contract.OUTSIDE_DOMAIN

    ds = _dataset_grid()
    for name, values in base.items():
        ds[name] = xr.DataArray(
            values.astype(np.float32),
            dims=("lat", "lon"),
            attrs={"units": "1", "description": f"synthetic {name}"},
        )
    ds["trend_class"] = xr.DataArray(
        classes,
        dims=("lat", "lon"),
        attrs={"description": "synthetic trend class"},
    )
    ds.attrs.update(
        {
            "schema_version": contract.SCHEMA_VERSION,
            "variable_id": variable_id,
            "window_id": WINDOW,
            "synthetic": 1,
        }
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    ds.to_netcdf(
        path,
        engine="netcdf4",
        encoding={
            name: {"dtype": "int8" if name == "trend_class" else "float32", "zlib": True, "complevel": 1}
            for name in ds.data_vars
        },
    )
    ds.close()


def _write_witness_trend_file(
    path: Path, variable_id: str, mask: np.ndarray
) -> None:
    """Synthetic P13 witness trend file for the export fixture."""
    shape = (contract.N_ROWS, contract.N_COLS)
    outside = ~mask
    base = {
        "sen_slope": np.full(shape, 0.2, dtype=float),
        "sen_slope_decade": np.full(shape, 2.0, dtype=float),
        "std_change_decade": np.full(shape, 0.7, dtype=float),
        "p_value": np.full(shape, 0.5, dtype=float),
        "p_value_original": np.full(shape, 0.5, dtype=float),
        "q_value": np.full(shape, 0.5, dtype=float),
        "mk_tau": np.full(shape, 0.1, dtype=float),
        "n_valid": np.full(shape, float(contract.N_MONTHS), dtype=float),
        "coverage": np.full(shape, 1.0, dtype=float),
    }
    classes = np.zeros(shape, dtype=np.int8)
    for name in base:
        base[name][outside] = np.nan
        base[name][INSUFFICIENT] = np.nan
    classes[outside] = contract.OUTSIDE_DOMAIN
    classes[INSUFFICIENT] = contract.INSUFFICIENT_DATA

    # Temperature witness agrees with the main warming marker (code 2).
    # Moisture witness warms while the main moisture marker dries (code -2).
    base["sen_slope"][MARKER] = 1.0
    base["sen_slope_decade"][MARKER] = 10.0
    base["q_value"][MARKER] = 0.001
    classes[MARKER] = contract.TREND_INCREASE

    ds = _dataset_grid()
    for name, values in base.items():
        ds[name] = xr.DataArray(
            values.astype(np.float32),
            dims=("lat", "lon"),
            attrs={"units": "1", "description": f"synthetic witness {name}"},
        )
    ds["trend_class"] = xr.DataArray(
        classes,
        dims=("lat", "lon"),
        attrs={"description": "synthetic witness trend class"},
    )
    ds.attrs.update(
        {
            "schema_version": contract.SCHEMA_VERSION,
            "variable_id": variable_id,
            "window_id": WINDOW,
            "synthetic": 1,
        }
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    ds.to_netcdf(
        path,
        engine="netcdf4",
        encoding={
            name: {
                "dtype": "int8" if name == "trend_class" else "float32",
                "zlib": True,
                "complevel": 1,
            }
            for name in ds.data_vars
        },
    )
    ds.close()


def _monthly_values(
    mask: np.ndarray, marker_value: float, offset: float
) -> np.ndarray:
    months = contract.N_MONTHS
    values = np.full(
        (months, contract.N_ROWS, contract.N_COLS), np.nan, dtype=np.float32
    )
    rows, cols = np.nonzero(mask)
    ramp = np.arange(months, dtype=np.float32)[:, None] * 0.01
    for row, col in zip(rows, cols):
        cell = 1.0 + (row % 10) + 0.1 * (col % 10) + ramp[:, 0]
        values[:, row, col] = cell + offset
    values[:, MARKER[0], MARKER[1]] = marker_value + ramp[:, 0]
    return values


def _write_monthly_cube(
    path: Path,
    name: str,
    values: np.ndarray,
    mask: np.ndarray,
    units: str,
    include_climatology: bool,
) -> None:
    time = np.array([np.datetime64(f"{label}-01") for label in month_labels()])
    assert time.size == contract.N_MONTHS
    ds = _dataset_grid()
    ds["time"] = ("time", time)
    ds[name] = xr.DataArray(
        values,
        dims=("time", "lat", "lon"),
        attrs={"units": units},
    )
    if include_climatology:
        climatology = np.full(
            (12, contract.N_ROWS, contract.N_COLS), np.nan, dtype=np.float32
        )
        climatology[:, mask] = 4.0
        ds["climatology"] = xr.DataArray(
            climatology,
            dims=("month", "lat", "lon"),
            attrs={"units": units},
        )
    ds.attrs.update({"units": units, "variable_id": path.stem})
    path.parent.mkdir(parents=True, exist_ok=True)
    ds.to_netcdf(
        path,
        engine="netcdf4",
        encoding={
            name: {"dtype": "float32", "zlib": True, "complevel": 1}
            for name in ds.data_vars
        },
    )
    ds.close()


def _write_correlation_file(path: Path, mask: np.ndarray) -> None:
    shape = (contract.N_ROWS, contract.N_COLS)
    outside = ~mask
    layers = {
        "r": np.full(shape, 0.2, dtype=np.float32),
        "q": np.full(shape, 0.5, dtype=np.float32),
        "r_detrended": np.full(shape, 0.15, dtype=np.float32),
        "q_detrended": np.full(shape, 0.4, dtype=np.float32),
        "n_pairs": np.full(shape, 288.0, dtype=np.float32),
    }
    for values in layers.values():
        values[outside] = np.nan
        values[INSUFFICIENT] = np.nan
    layers["r"][MARKER] = 0.75
    layers["q"][MARKER] = 0.01

    ds = _dataset_grid()
    for name, values in layers.items():
        ds[name] = xr.DataArray(values, dims=("lat", "lon"))
    ds.attrs.update({"pair_id": PAIR, "window_id": WINDOW, "synthetic": 1})
    path.parent.mkdir(parents=True, exist_ok=True)
    ds.to_netcdf(
        path,
        engine="netcdf4",
        encoding={
            name: {"dtype": "float32", "zlib": True, "complevel": 1}
            for name in ds.data_vars
        },
    )
    ds.close()


def _build_fixture(root: Path) -> dict:
    mask = np.zeros((contract.N_ROWS, contract.N_COLS), dtype=bool)
    mask[MASK_ROWS, MASK_COLS] = True

    interim = root / "harmonized_monthly"
    anomalies = root / "anomalies"
    trends = root / "trends"
    correlations = root / "correlations"
    witness_trends = root / "witness" / "trends"
    witness_anomalies = root / "witness" / "anomalies"
    regions_path = root / "regions.yaml"

    mask_ds = _dataset_grid()
    mask_ds["common_mask"] = xr.DataArray(
        mask.astype(np.int8), dims=("lat", "lon")
    )
    interim.mkdir(parents=True, exist_ok=True)
    mask_ds.to_netcdf(
        interim / "common_mask.nc",
        engine="netcdf4",
        encoding={"common_mask": {"dtype": "int8", "zlib": True}},
    )
    mask_ds.close()

    values_by_variable: dict[str, np.ndarray] = {}
    anomalies_by_variable: dict[str, np.ndarray] = {}
    witness_by_variable: dict[str, np.ndarray] = {}
    for variable_id, marker, unit, witness_unit in (
        (TEMPERATURE, 5.0, "degC", "K"),
        (MOISTURE, 7.0, "kg m-2", "wetness fraction"),
    ):
        values = _monthly_values(mask, marker, 0.0)
        anomaly_values = values - 4.0
        values_by_variable[variable_id] = values
        anomalies_by_variable[variable_id] = anomaly_values
        _write_monthly_cube(
            interim / f"{variable_id}.nc",
            variable_id,
            values,
            mask,
            unit,
            include_climatology=False,
        )
        _write_monthly_cube(
            anomalies / f"{variable_id}.nc",
            "anomaly",
            anomaly_values,
            mask,
            unit,
            include_climatology=True,
        )
        _write_trend_file(trends / variable_id / f"{WINDOW}.nc", variable_id, mask)
        _write_witness_trend_file(
            witness_trends / variable_id / f"{WINDOW}.nc", variable_id, mask
        )
        witness_values = anomaly_values * 0.5 + 0.25
        witness_by_variable[variable_id] = witness_values
        _write_monthly_cube(
            witness_anomalies / f"{variable_id}.nc",
            "anomaly",
            witness_values,
            mask,
            witness_unit,
            include_climatology=False,
        )

    _write_correlation_file(correlations / PAIR / f"{WINDOW}.nc", mask)

    region_bbox = [11.0, 22.0, 14.0, 25.0]
    regions = {
        "regions": [
            {"id": "sahara_box", "label": "Sahara test box", "bbox": region_bbox},
            {"id": "empty_ocean", "label": "Empty test box", "bbox": [0, 0, 5, 5]},
        ]
    }
    regions_path.write_text(yaml.safe_dump(regions), encoding="utf-8")

    countries_path = root / "countries.geojson"
    countries_path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "id": "001",
                        "properties": {"name": "Testland"},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [
                                [
                                    [5.0, 20.0],
                                    [16.0, 20.0],
                                    [16.0, 30.0],
                                    [5.0, 30.0],
                                    [5.0, 20.0],
                                ]
                            ],
                        },
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    return {
        "root": root,
        "mask": mask,
        "interim": interim,
        "anomalies": anomalies,
        "trends": trends,
        "correlations": correlations,
        "witness_trends": witness_trends,
        "witness_anomalies": witness_anomalies,
        "regions_path": regions_path,
        "countries_path": countries_path,
        "values": values_by_variable,
        "anomalies_values": anomalies_by_variable,
        "witness_values": witness_by_variable,
        "region_bbox": region_bbox,
    }


@pytest.fixture(scope="module")
def exported(tmp_path_factory: pytest.TempPathFactory) -> SimpleNamespace:
    fixture_root = tmp_path_factory.mktemp("pexport")
    info = _build_fixture(fixture_root)
    out = fixture_root / "web_data"
    summary = export_all(
        out,
        interim_dir=info["interim"],
        anomaly_dir=info["anomalies"],
        trends_dir=info["trends"],
        correlations_dir=info["correlations"],
        witness_trends_dir=info["witness_trends"],
        witness_anomaly_dir=info["witness_anomalies"],
        regions_path=info["regions_path"],
        country_geojson_path=info["countries_path"],
        variable_ids=[TEMPERATURE, MOISTURE],
        window_ids=[WINDOW],
    )
    return SimpleNamespace(**info, out=out, summary=summary)


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _read_grid(path: Path) -> np.ndarray:
    return np.fromfile(path, dtype="<f4").reshape(contract.N_ROWS, contract.N_COLS)


def test_index_follows_contract(exported: SimpleNamespace) -> None:
    index = _read_json(exported.out / "index.json")

    assert index["synthetic"] is False
    assert index["schema_version"] == EXPORT_SCHEMA_VERSION
    assert index["schema_version"] == "1.3"
    assert index["generated_at"].endswith("Z")
    assert index["months"] == month_labels()
    assert index["baseline"] == list(contract.BASELINE)
    assert index["q_threshold"] == contract.Q_THRESHOLD
    assert index["windows"] == [
        {"id": WINDOW, "start": "2001-01", "end": "2024-12"}
    ]
    assert [entry["id"] for entry in index["variables"]] == [
        TEMPERATURE,
        MOISTURE,
    ]
    temperature = index["variables"][0]
    assert temperature["product_version"] == "2.1"
    assert temperature["doi"] == "10.5067/LWTYSMP3VM5Z"
    assert temperature["source_type"] == "model"
    assert temperature["display_unit"] == "degC"
    assert temperature["slope_unit"] == "degC per year"
    assert temperature["core"] is True
    assert temperature["increase_means"] == "warmer"
    assert index["pattern_pair"] == {
        "temperature": TEMPERATURE,
        "moisture": MOISTURE,
    }
    assert index["correlation_pairs"] == [PAIR]
    assert index["layers"] == {
        "float": list(contract.FLOAT_LAYERS),
        "class": list(contract.CLASS_LAYERS),
    }
    assert index["tiles"]["size"] == contract.TILE_SIZE
    assert "r060_c190" in index["tiles"]["ids"]
    assert index["tiles"]["ids"] == sorted(index["tiles"]["ids"])
    assert index["quality"]["layers"] == list(contract.QUALITY_LAYERS)
    assert "Pettitt" in index["quality"]["method"]
    assert index["quality"]["known_forcing_changes"]["GLDAS_NOAH10_M"] == [2008, 2012]
    assert index["witness"]["layers"] == list(contract.WITNESS_LAYERS)
    assert "Sen" in index["witness"]["method"]
    assert index["witness"]["products"][TEMPERATURE] == {
        "product": "M2TMNXSLV",
        "version": "5.12.4",
        "source_variable": "TS",
        "doi": "10.5067/AP1B0BA5PD2K",
        "label": "MERRA-2 reanalysis",
    }
    assert index["witness"]["products"][MOISTURE]["product"] == "M2TMNXLND"


def test_grid_roundtrip_marker_at_contract_row_col(
    exported: SimpleNamespace,
) -> None:
    assert contract.row_to_lat(MARKER[0]) == 23.5
    assert contract.col_to_lon(MARKER[1]) == 12.5
    folder = exported.out / "grids" / TEMPERATURE / WINDOW
    slope = _read_grid(folder / "sen_slope_decade.f32")
    assert slope[MARKER] == pytest.approx(10.0)
    assert np.isnan(slope[0, 0])

    classes = np.fromfile(folder / "trend_class.i8", dtype=np.int8).reshape(
        contract.N_ROWS, contract.N_COLS
    )
    assert classes[MARKER] == contract.TREND_INCREASE
    assert classes[INSUFFICIENT] == contract.INSUFFICIENT_DATA
    assert classes[0, 0] == contract.OUTSIDE_DOMAIN

    q_values = _read_grid(folder / "q_value.f32")
    assert q_values[MARKER] == pytest.approx(0.001)
    assert np.isnan(q_values[0, 0])
    assert np.isnan(q_values[INSUFFICIENT])


def test_pattern_class_uses_significant_pair(exported: SimpleNamespace) -> None:
    patterns = np.fromfile(
        exported.out / "patterns" / WINDOW / "pattern_class.i8", dtype=np.int8
    ).reshape(contract.N_ROWS, contract.N_COLS)

    assert patterns[MARKER] == contract.PATTERN_WARMING_DRYING
    assert patterns[INSUFFICIENT] == contract.INSUFFICIENT_DATA
    assert patterns[0, 0] == contract.OUTSIDE_DOMAIN


def test_correlation_layers_are_exported(exported: SimpleNamespace) -> None:
    folder = exported.out / "correlations" / PAIR / WINDOW
    r_values = _read_grid(folder / "r.f32")
    q_values = _read_grid(folder / "q.f32")
    n_pairs = _read_grid(folder / "n_pairs.f32")

    assert r_values[MARKER] == pytest.approx(0.75)
    assert q_values[MARKER] == pytest.approx(0.01)
    assert n_pairs[MARKER] == pytest.approx(288.0)
    assert np.isnan(r_values[0, 0])


def test_quality_layers_are_exported(exported: SimpleNamespace) -> None:
    folder = exported.out / "grids" / TEMPERATURE / WINDOW
    flag_path = folder / "quality_flag.i8"
    break_path = folder / "breakpoint_year.f32"
    assert flag_path.stat().st_size == contract.N_ROWS * contract.N_COLS
    assert break_path.stat().st_size == contract.N_ROWS * contract.N_COLS * 4

    flags = np.fromfile(flag_path, dtype=np.int8).reshape(
        contract.N_ROWS, contract.N_COLS
    )
    breakpoint = _read_grid(break_path)
    assert flags[MARKER] == contract.QUALITY_NONE
    assert flags[INSUFFICIENT] == contract.INSUFFICIENT_DATA
    assert flags[0, 0] == contract.OUTSIDE_DOMAIN
    assert np.isnan(breakpoint[MARKER])
    assert np.isnan(breakpoint[INSUFFICIENT])


def test_witness_layers_are_exported(exported: SimpleNamespace) -> None:
    folder = exported.out / "grids" / TEMPERATURE / WINDOW
    agreement_path = folder / "witness_agreement.i8"
    std_path = folder / "witness_std_change.f32"
    assert agreement_path.stat().st_size == contract.N_ROWS * contract.N_COLS
    assert std_path.stat().st_size == contract.N_ROWS * contract.N_COLS * 4

    agreement = np.fromfile(agreement_path, dtype=np.int8).reshape(
        contract.N_ROWS, contract.N_COLS
    )
    std = _read_grid(std_path)
    assert agreement[MARKER] == contract.WITNESS_CORROBORATED
    assert std[MARKER] == pytest.approx(0.7)
    assert agreement[INSUFFICIENT] == contract.INSUFFICIENT_DATA
    assert np.isnan(std[INSUFFICIENT])
    assert agreement[0, 0] == contract.OUTSIDE_DOMAIN
    assert np.isnan(std[0, 0])

    moisture = np.fromfile(
        exported.out / "grids" / MOISTURE / WINDOW / "witness_agreement.i8",
        dtype=np.int8,
    ).reshape(contract.N_ROWS, contract.N_COLS)
    assert moisture[MARKER] == contract.WITNESS_CONTRADICTED


def test_country_domains_are_exported(exported: SimpleNamespace) -> None:
    regions = _read_json(exported.out / "regions.json")
    assert regions["regions"][0]["kind"] == "box"
    assert regions["country_grid"] == contract.COUNTRY_GRID_FILE
    assert len(regions["countries"]) == 1
    country = regions["countries"][0]
    assert country["id"] == COUNTRY_ID
    assert country["label"] == "Testland"
    assert country["iso_numeric"] == "001"
    assert country["n_cells"] == 110
    assert country["index"] == 0

    grid_path = exported.out / contract.COUNTRY_GRID_FILE
    assert grid_path.stat().st_size == contract.N_ROWS * contract.N_COLS * 2
    grid = np.fromfile(grid_path, dtype="<i2").reshape(
        contract.N_ROWS, contract.N_COLS
    )
    assert grid[MARKER] == country["index"]
    assert grid[0, 0] == contract.COUNTRY_NONE

    screener = _read_json(
        exported.out / "screener" / WINDOW / f"{COUNTRY_ID}.json"
    )
    assert screener["domain"] == COUNTRY_ID
    assert len(screener["rows"]) == 2
    series = _read_json(
        exported.out
        / "series"
        / "regions"
        / COUNTRY_ID
        / f"{TEMPERATURE}.json"
    )
    assert series["region"] == COUNTRY_ID
    assert len(series["values"]) == contract.N_MONTHS


def test_region_series_matches_hand_computed_weighted_mean(
    exported: SimpleNamespace,
) -> None:
    series = _read_json(
        exported.out / "series" / "regions" / "sahara_box" / f"{TEMPERATURE}.json"
    )
    assert set(series) == {
        "region",
        "variable",
        "synthetic",
        "unit",
        "months",
        "values",
        "anomalies",
        "valid_cell_fraction",
        "witness_anomalies",
        "witness_unit",
    }
    assert series["synthetic"] is False
    assert series["unit"] == "degC"
    assert series["months"] == month_labels()
    assert len(series["values"]) == contract.N_MONTHS
    assert len(series["witness_anomalies"]) == contract.N_MONTHS

    west, south, east, north = exported.region_bbox
    region_mask = (
        exported.mask
        & (TARGET_LAT[:, None] >= south)
        & (TARGET_LAT[:, None] <= north)
        & (TARGET_LON[None, :] >= west)
        & (TARGET_LON[None, :] <= east)
    )
    weights = np.cos(np.deg2rad(TARGET_LAT))[:, None] * region_mask
    for month in (0, 5, 287):
        values = exported.values[TEMPERATURE][month]
        expected = float(np.sum(values[region_mask] * weights[region_mask]) / weights.sum())
        assert series["values"][month] == pytest.approx(round(expected, 4))
        anomaly = exported.anomalies_values[TEMPERATURE][month]
        expected_anomaly = float(
            np.sum(anomaly[region_mask] * weights[region_mask]) / weights.sum()
        )
        assert series["anomalies"][month] == pytest.approx(
            round(expected_anomaly, 4)
        )
        witness = exported.witness_values[TEMPERATURE][month]
        expected_witness = float(
            np.sum(witness[region_mask] * weights[region_mask]) / weights.sum()
        )
        assert series["witness_anomalies"][month] == pytest.approx(
            round(expected_witness, 4)
        )
        assert series["witness_unit"] == "K"
        assert series["valid_cell_fraction"][month] == pytest.approx(1.0)

    empty = _read_json(
        exported.out / "series" / "regions" / "empty_ocean" / f"{TEMPERATURE}.json"
    )
    assert set(empty["values"]) == {None}
    assert set(empty["anomalies"]) == {None}
    assert set(empty["witness_anomalies"]) == {None}
    assert set(empty["valid_cell_fraction"]) == {None}


def test_tile_offset_and_nan_outside_mask(exported: SimpleNamespace) -> None:
    folder = exported.out / "series" / "tiles" / TEMPERATURE
    assert not (folder / "r060_c190.values.f32").exists()

    path = folder / "r060_c190.anomalies.f32"
    assert path.stat().st_size == 288 * 100 * 4
    tile = np.fromfile(path, dtype="<f4").reshape(288, 10, 10)

    row_offset = MARKER[0] % 10
    col_offset = MARKER[1] % 10
    for month in (0, 5, 287):
        offset = month * 100 + row_offset * 10 + col_offset
        flat = np.fromfile(path, dtype="<f4")
        assert flat[offset] == pytest.approx(
            exported.anomalies_values[TEMPERATURE][month, MARKER[0], MARKER[1]]
        )
        assert tile[month, row_offset, col_offset] == pytest.approx(
            exported.anomalies_values[TEMPERATURE][month, MARKER[0], MARKER[1]]
        )
    # The tile includes cols 196..199, which are outside the synthetic mask.
    assert np.isnan(tile[0, row_offset, 9])


def test_climatology_file_is_exported(exported: SimpleNamespace) -> None:
    path = exported.out / "series" / "climatology" / f"{TEMPERATURE}.f32"
    assert path.stat().st_size == 12 * contract.N_ROWS * contract.N_COLS * 4
    climatology = np.fromfile(path, dtype="<f4").reshape(
        12, contract.N_ROWS, contract.N_COLS
    )
    assert np.allclose(climatology[:, MARKER[0], MARKER[1]], 4.0)
    assert np.isnan(climatology[:, 0, 0]).all()


def test_screener_covers_every_variable_and_domain(
    exported: SimpleNamespace,
) -> None:
    for domain_id in ("global", "sahara_box", "empty_ocean", COUNTRY_ID):
        data = _read_json(exported.out / "screener" / WINDOW / f"{domain_id}.json")
        assert set(data) == {"window", "domain", "synthetic", "rows"}
        assert data["window"] == WINDOW
        assert data["domain"] == domain_id
        assert data["synthetic"] is False
        assert {row["variable"] for row in data["rows"]} == {
            TEMPERATURE,
            MOISTURE,
        }
        for row in data["rows"]:
            assert set(row) == {
                "variable",
                "valid_area_fraction",
                "sig_increase_area_fraction",
                "sig_decrease_area_fraction",
                "median_abs_std_change_decade",
                "median_sen_slope_decade_sig",
                "regional_contrast",
                "n_cells_evaluated",
                "step_flag_area_fraction",
                "sig_trend_flagged_fraction",
                "witness_corroborated_fraction",
                "witness_contradicted_fraction",
            }
            if domain_id == "empty_ocean":
                assert row["step_flag_area_fraction"] is None
                assert row["sig_trend_flagged_fraction"] is None
                assert row["witness_corroborated_fraction"] is None
                assert row["witness_contradicted_fraction"] is None
            else:
                assert row["step_flag_area_fraction"] == 0.0
                assert row["sig_trend_flagged_fraction"] == 0.0
                if row["variable"] == TEMPERATURE:
                    assert row["witness_corroborated_fraction"] == 1.0
                    assert row["witness_contradicted_fraction"] == 0.0
                else:
                    assert row["witness_corroborated_fraction"] == 0.0
                    assert row["witness_contradicted_fraction"] == 1.0

    empty_rows = _read_json(
        exported.out / "screener" / WINDOW / "empty_ocean.json"
    )["rows"]
    assert all(row["n_cells_evaluated"] == 0 for row in empty_rows)
    assert all(row["valid_area_fraction"] is None for row in empty_rows)


def test_validator_passes_on_generated_export(exported: SimpleNamespace) -> None:
    result = validate_export(exported.out)
    assert result["ok"], result["errors"]
    assert result["schema_version"] == "1.3"
    assert result["synthetic"] is False
    assert result["files"] > 0
    assert result["bytes"] > 0


def _copy_export(exported: SimpleNamespace, tmp_path: Path) -> Path:
    target = tmp_path / "copy"
    shutil.copytree(exported.out, target)
    return target


def test_validator_detects_truncated_grid(
    exported: SimpleNamespace, tmp_path: Path
) -> None:
    folder = _copy_export(exported, tmp_path)
    path = folder / "grids" / TEMPERATURE / WINDOW / "sen_slope.f32"
    path.write_bytes(path.read_bytes()[:100])

    result = validate_export(folder)
    assert not result["ok"]
    assert any("size" in error for error in result["errors"])


def test_validator_detects_illegal_class_code(
    exported: SimpleNamespace, tmp_path: Path
) -> None:
    folder = _copy_export(exported, tmp_path)
    path = folder / "grids" / TEMPERATURE / WINDOW / "trend_class.i8"
    np.full(contract.N_ROWS * contract.N_COLS, 2, dtype=np.int8).tofile(path)

    result = validate_export(folder)
    assert not result["ok"]
    assert any("illegal class" in error for error in result["errors"])


def test_validator_detects_missing_file(
    exported: SimpleNamespace, tmp_path: Path
) -> None:
    folder = _copy_export(exported, tmp_path)
    (folder / "series" / "tiles" / TEMPERATURE / "r060_c190.anomalies.f32").unlink()

    result = validate_export(folder)
    assert not result["ok"]
    assert any("missing file" in error for error in result["errors"])


def test_validator_detects_missing_climatology(
    exported: SimpleNamespace, tmp_path: Path
) -> None:
    folder = _copy_export(exported, tmp_path)
    (folder / "series" / "climatology" / f"{TEMPERATURE}.f32").unlink()

    result = validate_export(folder)
    assert not result["ok"]
    assert any("climatology" in error for error in result["errors"])


def test_validator_detects_missing_quality_layer(
    exported: SimpleNamespace, tmp_path: Path
) -> None:
    folder = _copy_export(exported, tmp_path)
    (
        folder / "grids" / TEMPERATURE / WINDOW / "quality_flag.i8"
    ).unlink()

    result = validate_export(folder)
    assert not result["ok"]
    assert any("quality_flag" in error for error in result["errors"])


def test_validator_detects_wrong_witness_code(
    exported: SimpleNamespace, tmp_path: Path
) -> None:
    folder = _copy_export(exported, tmp_path)
    path = folder / "grids" / TEMPERATURE / WINDOW / "witness_agreement.i8"
    values = np.fromfile(path, dtype=np.int8)
    values[MARKER[0] * contract.N_COLS + MARKER[1]] = 7
    values.tofile(path)

    result = validate_export(folder)
    assert not result["ok"]
    assert any("illegal witness codes" in error for error in result["errors"])


def test_validator_detects_missing_witness_file(
    exported: SimpleNamespace, tmp_path: Path
) -> None:
    folder = _copy_export(exported, tmp_path)
    (
        folder / "grids" / TEMPERATURE / WINDOW / "witness_agreement.i8"
    ).unlink()

    result = validate_export(folder)
    assert not result["ok"]
    assert any("witness_agreement.i8" in error for error in result["errors"])


def test_validator_detects_unknown_country_index(
    exported: SimpleNamespace, tmp_path: Path
) -> None:
    folder = _copy_export(exported, tmp_path)
    path = folder / contract.COUNTRY_GRID_FILE
    values = np.fromfile(path, dtype="<i2")
    values[0] = 99
    values.tofile(path)

    result = validate_export(folder)
    assert not result["ok"]
    assert any("country indices" in error for error in result["errors"])


def test_validator_release_rejects_synthetic(
    exported: SimpleNamespace, tmp_path: Path
) -> None:
    folder = _copy_export(exported, tmp_path)
    index_path = folder / "index.json"
    index = _read_json(index_path)
    index["synthetic"] = True
    index_path.write_text(json.dumps(index), encoding="utf-8")

    assert validate_export(folder, release=False)["ok"]
    result = validate_export(folder, release=True)
    assert not result["ok"]
    assert result["synthetic"] is True
    assert any("synthetic" in error for error in result["errors"])


def test_publish_refuses_invalid_export(
    exported: SimpleNamespace, tmp_path: Path
) -> None:
    folder = _copy_export(exported, tmp_path)
    path = folder / "grids" / TEMPERATURE / WINDOW / "sen_slope.f32"
    path.write_bytes(path.read_bytes()[:100])
    target = tmp_path / "published"

    with pytest.raises(RuntimeError, match="refusing to publish"):
        publish_export(folder, target)
    assert not target.exists()


def test_publish_copies_valid_export(
    exported: SimpleNamespace, tmp_path: Path
) -> None:
    target = tmp_path / "published"
    result = publish_export(exported.out, target)
    assert result["ok"]
    assert (target / "index.json").is_file()
    assert _read_json(target / "index.json")["synthetic"] is False


def test_export_refuses_web_public_output() -> None:
    with pytest.raises(ValueError, match="refusing to export directly"):
        export_all(WEB_DATA_DIR)
