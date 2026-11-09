"""P10 tests for the country grid builder (no network access)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from earthpulse import contract
from earthpulse.regions import build_country_grid, country_cells_in_mask

ROOT = Path(__file__).resolve().parents[1]
COUNTRY_GEOJSON = ROOT / "config" / "countries" / "countries-50m.geojson"


def _feature(iso: str, name: str, geometry: dict) -> dict:
    return {
        "type": "Feature",
        "id": iso,
        "properties": {"name": name},
        "geometry": geometry,
    }


def _collection(features: list[dict]) -> dict:
    return {"type": "FeatureCollection", "features": features}


def _write_geojson(path: Path, features: list[dict]) -> Path:
    path.write_text(json.dumps(_collection(features)), encoding="utf-8")
    return path


def _cell(lat: float, lon: float) -> tuple[int, int]:
    return contract.lat_to_row(lat), contract.lon_to_col(lon)


def test_synthetic_polygon_hole_and_multipolygon(tmp_path: Path) -> None:
    """Exterior rings, holes and MultiPolygons are assigned at cell centres."""

    with_hole = {
        "type": "Polygon",
        "coordinates": [
            [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
            [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
        ],
    }
    multipolygon = {
        "type": "MultiPolygon",
        "coordinates": [
            [[[20, 0], [22, 0], [22, 2], [20, 2], [20, 0]]],
            [[[30, 0], [32, 0], [32, 2], [30, 2], [30, 0]]],
        ],
    }
    path = _write_geojson(
        tmp_path / "countries.geojson",
        [
            _feature("002", "Multi", multipolygon),
            _feature("001", "Donut", with_hole),
        ],
    )
    grid, countries = build_country_grid(path)

    assert grid.shape == (contract.N_ROWS, contract.N_COLS)
    assert grid.dtype == np.int16
    assert [country["id"] for country in countries] == ["country_001", "country_002"]
    assert [country["index"] for country in countries] == [0, 1]

    donut, multi = countries
    assert grid[_cell(0.5, 0.5)] == donut["index"]
    assert grid[_cell(9.5, 9.5)] == donut["index"]
    assert grid[_cell(5.5, 5.5)] == contract.COUNTRY_NONE  # hole
    assert grid[_cell(1.5, 21.5)] == multi["index"]
    assert grid[_cell(1.5, 31.5)] == multi["index"]
    assert grid[_cell(50.5, 50.5)] == contract.COUNTRY_NONE


def test_synthetic_antimeridian_polygon(tmp_path: Path) -> None:
    """A polygon expressed as 170..190 assigns cells on both sides of 180."""

    polygon = {
        "type": "Polygon",
        "coordinates": [
            [[170, 10], [190, 10], [190, 20], [170, 20], [170, 10]]
        ],
    }
    path = _write_geojson(
        tmp_path / "antimeridian.geojson",
        [_feature("003", "Dateline", polygon)],
    )
    grid, countries = build_country_grid(path)
    index = countries[0]["index"]

    assert grid[_cell(15.5, 179.5)] == index
    assert grid[_cell(15.5, -179.5)] == index
    assert grid[_cell(15.5, 160.5)] == contract.COUNTRY_NONE


def test_country_cells_in_mask() -> None:
    """Counts use only cells inside the mask and ignore COUNTRY_NONE."""

    grid = np.full((contract.N_ROWS, contract.N_COLS), contract.COUNTRY_NONE, dtype=np.int16)
    grid[0, 0] = 0
    grid[0, 1] = 0
    grid[1, 0] = 1
    grid[1, 1] = 1
    grid[2, 0] = 0
    mask = np.zeros_like(grid, dtype=bool)
    mask[0, 0] = True
    mask[0, 1] = True
    mask[1, 1] = True
    assert country_cells_in_mask(grid, mask) == {0: 2, 1: 1}
    assert country_cells_in_mask(grid, np.zeros_like(mask)) == {}

    with pytest.raises(ValueError):
        country_cells_in_mask(grid[:, :-1], mask)


@pytest.fixture(scope="module")
def real_countries() -> tuple[np.ndarray, list[dict]]:
    assert COUNTRY_GEOJSON.is_file(), f"missing {COUNTRY_GEOJSON}"
    return build_country_grid(COUNTRY_GEOJSON)


def test_real_country_ordering_and_shape(real_countries: tuple[np.ndarray, list[dict]]) -> None:
    grid, countries = real_countries
    assert grid.shape == (contract.N_ROWS, contract.N_COLS)
    assert grid.dtype == np.int16
    assert len(countries) > 200
    ids = [country["iso_numeric"] for country in countries]
    assert ids == sorted(ids)
    assert [country["index"] for country in countries] == list(range(len(countries)))
    assert all(country["id"] == f"country_{country['iso_numeric']}" for country in countries)
    assert all(len(country["bbox"]) == 4 for country in countries)


def test_real_known_cells(real_countries: tuple[np.ndarray, list[dict]]) -> None:
    grid, countries = real_countries
    by_name = {country["label"]: country for country in countries}

    vietnam = by_name["Vietnam"]
    france = by_name["France"]
    russia = by_name["Russia"]

    assert grid[_cell(21.0, 105.8)] == vietnam["index"]  # Hanoi
    assert grid[_cell(48.8566, 2.3522)] == france["index"]  # Paris
    assert grid[_cell(0.0, -140.0)] == contract.COUNTRY_NONE  # mid-Pacific
    assert grid[_cell(66.5, -179.5)] == russia["index"]  # Chukotka, east of 180
    assert int((grid == vietnam["index"]).sum()) >= 20
