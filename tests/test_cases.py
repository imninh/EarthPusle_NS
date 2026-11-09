"""Tests for P06 automatic Detective Cases.

All grids are synthetic and built inside the tests; no EarthPulse data values
are used.  Run with ``.venv/Scripts/python -m pytest``.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from earthpulse import contract
from earthpulse.cases import (
    build_cases_file,
    cluster_components,
    country_candidates,
    dumps_cases,
    pattern_candidates,
    select_cases,
    trend_candidates,
)
from earthpulse.screener import weighted_median

SHAPE = (contract.N_ROWS, contract.N_COLS)


def _layers(
    classes: np.ndarray,
    *,
    slope: float = 1.0,
    std: float = 0.5,
    q: float = 0.01,
    p: float = 0.01,
    coverage: float = 1.0,
    n_valid: float = 288.0,
) -> dict[str, np.ndarray]:
    return {
        "trend_class": np.asarray(classes, dtype=np.int8),
        "sen_slope_decade": np.full(SHAPE, slope, dtype=float),
        "std_change_decade": np.full(SHAPE, std, dtype=float),
        "q_value": np.full(SHAPE, q, dtype=float),
        "p_value": np.full(SHAPE, p, dtype=float),
        "n_valid": np.full(SHAPE, n_valid, dtype=float),
        "coverage": np.full(SHAPE, coverage, dtype=float),
    }


def _classes(fill: int = contract.TREND_NOT_SIGNIFICANT) -> np.ndarray:
    return np.full(SHAPE, fill, dtype=np.int8)


def _blob(
    classes: np.ndarray,
    *,
    row: int,
    col: int,
    height: int,
    width: int,
    value: int,
) -> None:
    classes[row : row + height, col : col + width] = value


def _mask() -> np.ndarray:
    return np.ones(SHAPE, dtype=bool)


def _registry() -> dict:
    return {
        "products": {
            "GPM_3IMERGM": {"doi": "10.5067/GPM/IMERG/3B-MONTH/07"},
            "GLDAS_NOAH10_M": {"doi": "10.5067/LWTYSMP3VM5Z"},
        },
        "variables": [
            {
                "id": "precipitation",
                "label": "Precipitation",
                "product": "GPM_3IMERGM",
                "slope_unit": "mm/month per year",
                "caveats": ["Merged multi-satellite estimate."],
            },
            {
                "id": "surface_skin_temperature",
                "label": "Surface skin temperature",
                "product": "GLDAS_NOAH10_M",
                "slope_unit": "degC per year",
                "caveats": ["Model output."],
            },
            {
                "id": "root_zone_soil_moisture",
                "label": "Root-zone soil moisture",
                "product": "GLDAS_NOAH10_M",
                "slope_unit": "kg m-2 per year",
                "caveats": ["Model output."],
            },
        ]
    }


def test_cluster_components_8_and_4_connectivity() -> None:
    mask = np.zeros(SHAPE, dtype=bool)
    mask[90, 100:103] = True
    mask[91:94, 103] = True
    mask[50, 50] = True

    eight = cluster_components(mask, wrap_longitude=False)
    four = cluster_components(mask, connectivity=4, wrap_longitude=False)

    assert sorted(int(component.sum()) for component in eight) == [1, 6]
    assert sorted(int(component.sum()) for component in four) == [1, 3, 3]
    assert all(component.dtype == bool for component in eight)


def test_cluster_components_wrap_across_antimeridian() -> None:
    mask = np.zeros(SHAPE, dtype=bool)
    mask[90, 0] = True
    mask[90, contract.N_COLS - 1] = True

    assert len(cluster_components(mask, wrap_longitude=True)) == 1
    assert len(cluster_components(mask, wrap_longitude=False)) == 2


def test_minimum_area_rule_is_inclusive() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=15, value=contract.TREND_INCREASE)
    layers = _layers(classes)

    below = trend_candidates(layers, "precipitation", "2001-2024", mask=_mask(), min_cluster_cells=16)
    at_threshold = trend_candidates(layers, "precipitation", "2001-2024", mask=_mask(), min_cluster_cells=15)

    assert below == []
    assert len(at_threshold) == 1
    assert at_threshold[0]["cells"] == 15
    assert at_threshold[0]["trend_class"] == contract.TREND_INCREASE


def test_flagged_cells_are_excluded_before_the_minimum_area_test() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=20, value=contract.TREND_INCREASE)
    layers = _layers(classes)
    quality = np.zeros(SHAPE, dtype=np.int8)
    quality[90, 100:115] = 1  # 15 of 20 cells flagged
    quality[90, 115] = 2

    too_few = trend_candidates(
        layers,
        "precipitation",
        "2001-2024",
        mask=_mask(),
        quality_flag=quality,
        min_cluster_cells=15,
    )
    allowed = trend_candidates(
        layers,
        "precipitation",
        "2001-2024",
        mask=_mask(),
        quality_flag=quality,
        min_cluster_cells=4,
    )

    assert too_few == []
    assert len(allowed) == 1
    assert allowed[0]["cells"] == 4  # cells 116-119 are unflagged
    assert allowed[0]["quality_available"] is True
    assert allowed[0]["flagged_fraction"] == pytest.approx(16 / 20)


def test_flagged_cells_do_not_enter_the_evidence_numbers() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=20, value=contract.TREND_INCREASE)
    layers = _layers(classes)
    layers["sen_slope_decade"][90, 100:110] = 999.0  # flagged outliers
    quality = np.zeros(SHAPE, dtype=np.int8)
    quality[90, 100:110] = 1

    candidates = trend_candidates(
        layers,
        "precipitation",
        "2001-2024",
        mask=_mask(),
        quality_flag=quality,
        min_cluster_cells=10,
    )

    assert len(candidates) == 1
    assert candidates[0]["cells"] == 10
    assert candidates[0]["evidence"][0]["sen_slope_decade"] == pytest.approx(1.0)
    assert candidates[0]["evidence"][0]["quality_flag_fraction"] == pytest.approx(0.5)


def test_opposite_direction_pair_is_selected_for_one_variable() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=20, value=contract.TREND_INCREASE)
    _blob(classes, row=100, col=100, height=1, width=20, value=contract.TREND_DECREASE)
    layers = _layers(classes)
    candidates = trend_candidates(layers, "precipitation", "2001-2024", mask=_mask())

    selected = select_cases(candidates, max_cases=6, target_cases=4)

    pair = [case for case in selected if case["role"].startswith("opposite-pair")]
    assert len(pair) == 2
    assert {case["trend_class"] for case in pair} == {
        contract.TREND_INCREASE,
        contract.TREND_DECREASE,
    }
    assert {case["variable"] for case in pair} == {"precipitation"}


def test_pattern_candidate_uses_both_variables() -> None:
    temperature = _classes()
    moisture = _classes()
    _blob(
        temperature,
        row=90,
        col=100,
        height=2,
        width=10,
        value=contract.TREND_INCREASE,
    )
    _blob(
        moisture,
        row=90,
        col=100,
        height=2,
        width=10,
        value=contract.TREND_DECREASE,
    )
    candidates = pattern_candidates(
        {
            "surface_skin_temperature": _layers(temperature),
            "root_zone_soil_moisture": _layers(moisture, slope=-2.0),
        },
        "surface_skin_temperature",
        "root_zone_soil_moisture",
        "2001-2024",
        mask=_mask(),
        pattern_codes=(contract.PATTERN_WARMING_DRYING,),
        min_cluster_cells=15,
    )

    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["kind"] == "pattern"
    assert candidate["pattern_code"] == contract.PATTERN_WARMING_DRYING
    assert candidate["cells"] == 20
    assert [item["variable"] for item in candidate["evidence"]] == [
        "surface_skin_temperature",
        "root_zone_soil_moisture",
    ]
    assert candidate["evidence"][0]["trend_class"] == contract.TREND_INCREASE
    assert candidate["evidence"][1]["trend_class"] == contract.TREND_DECREASE


def test_case_numbers_are_traceable_to_the_input_arrays() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=20, value=contract.TREND_INCREASE)
    layers = _layers(classes)
    values = np.arange(1.0, 21.0)
    layers["sen_slope_decade"][90, 100:120] = values
    layers["std_change_decade"][90, 100:120] = values / 10.0
    layers["q_value"][90, 100:120] = values / 1000.0
    layers["p_value"][90, 100:120] = values / 2000.0
    layers["coverage"][90, 100:120] = 0.9

    candidate = trend_candidates(
        layers, "precipitation", "2001-2024", mask=_mask()
    )[0]
    expected_slope = weighted_median(
        layers["sen_slope_decade"][90, 100:120],
        np.full(20, np.cos(np.deg2rad(contract.row_to_lat(90)))),
    )
    expected_q = weighted_median(
        layers["q_value"][90, 100:120],
        np.full(20, np.cos(np.deg2rad(contract.row_to_lat(90)))),
    )

    assert candidate["evidence"][0]["sen_slope_decade"] == pytest.approx(expected_slope)
    assert candidate["evidence"][0]["q_value"] == pytest.approx(expected_q)
    assert candidate["evidence"][0]["coverage_fraction"] == pytest.approx(0.9)

    cases_file = build_cases_file([candidate], _registry())
    evidence = cases_file["cases"][0]["evidence"][0]
    assert evidence["sen_slope_decade"] == round(float(expected_slope), 6)
    assert evidence["q_value"] == round(float(expected_q), 8)
    assert evidence["coverage_fraction"] == 0.9
    assert evidence["product"] == "GPM_3IMERGM"
    assert evidence["doi"] == "10.5067/GPM/IMERG/3B-MONTH/07"
    assert evidence["slope_unit"] == "mm/month per decade"


def test_output_is_deterministic_even_when_candidate_order_changes() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=20, value=contract.TREND_INCREASE)
    _blob(classes, row=100, col=100, height=1, width=20, value=contract.TREND_DECREASE)
    layers = _layers(classes)
    candidates = trend_candidates(layers, "precipitation", "2001-2024", mask=_mask())

    first = build_cases_file(
        select_cases(candidates, max_cases=6, target_cases=4), _registry()
    )
    second = build_cases_file(
        select_cases(list(reversed(candidates)), max_cases=6, target_cases=4),
        _registry(),
    )

    assert dumps_cases(first) == dumps_cases(second)
    assert json.loads(dumps_cases(first))["cases"][0]["id"] == "case-01"


def test_config_overrides_change_wording_only() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=20, value=contract.TREND_INCREASE)
    candidate = trend_candidates(
        _layers(classes), "precipitation", "2001-2024", mask=_mask()
    )[0]
    selected = select_cases([candidate], max_cases=6, target_cases=4)
    base = build_cases_file(selected, _registry())
    overridden = build_cases_file(
        selected,
        _registry(),
        config={
            "overrides": {
                "case-01": {
                    "title": "Human title",
                    "why_selected": "Human wording.",
                }
            }
        },
    )

    assert overridden["cases"][0]["title"] == "Human title"
    assert overridden["cases"][0]["why_selected"] == "Human wording."
    assert overridden["cases"][0]["evidence"] == base["cases"][0]["evidence"]


def test_missing_quality_layer_is_reported_as_a_limitation() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=20, value=contract.TREND_INCREASE)
    candidate = trend_candidates(
        _layers(classes), "precipitation", "2001-2024", mask=_mask()
    )[0]
    cases_file = build_cases_file([candidate], _registry())
    limitations = " ".join(cases_file["cases"][0]["limitations"])

    assert candidate["quality_available"] is False
    assert "No data-quality" in limitations
    assert "Association is not causation" in limitations
    assert "Merged multi-satellite estimate." in limitations


def test_country_candidates_aggregate_the_country_domain() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=4, width=5, value=contract.TREND_DECREASE)
    layers = _layers(classes, slope=-2.0)
    grid = np.full(SHAPE, contract.COUNTRY_NONE, dtype=np.int16)
    grid[90:94, 100:105] = 7
    countries = [
        {
            "index": 7,
            "id": "country_999",
            "label": "Testland",
            "iso_numeric": "999",
            "bbox": [99.5, 85.5, 105.5, 89.5],
        }
    ]

    candidates = country_candidates(
        {"precipitation": layers},
        grid,
        countries,
        "2001-2024",
        mask=_mask(),
        min_cells=15,
    )

    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["kind"] == "country"
    assert candidate["country_id"] == "country_999"
    assert candidate["label"] == "Testland"
    assert candidate["cells"] == 20
    assert candidate["trend_class"] == contract.TREND_DECREASE
