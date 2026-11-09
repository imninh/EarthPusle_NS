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
    EARLY_WINDOW_QUALITY_LIMITATION,
    build_cases_file,
    build_caution_candidate,
    cluster_components,
    combine_quality_flags,
    country_candidates,
    dominant_country_label,
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


def _manual_candidate(
    variable: str,
    window: str,
    *,
    score: float = 1.0,
    cells: int = 20,
    trend_class: int = contract.TREND_INCREASE,
    kind: str = "global",
    country_id: str | None = None,
    label: str = "test region",
    bbox: list[float] | None = None,
    center: tuple[float, float] = (0.0, 0.0),
) -> dict:
    return {
        "kind": kind,
        "variable": variable,
        "variables": [variable],
        "window": window,
        "trend_class": trend_class,
        "pattern_code": None,
        "country_id": country_id,
        "cells": cells,
        "bbox": bbox or [center[1] - 2, center[0] - 2, center[1] + 2, center[0] + 2],
        "center": center,
        "label": label,
        "score": score,
        "score_adjustment": 1.0,
        "significant_share": 1.0,
        "flagged_fraction": 0.0,
        "quality_available": True,
        "quality_check_windows": [window],
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

def test_combine_quality_flags_keeps_stronger_code() -> None:
    primary = np.array([0, -9, 2, -99, 1], dtype=np.int8)
    extra = np.array([2, 1, 0, 1, 0], dtype=np.int8)

    combined = combine_quality_flags(primary, extra)

    assert combined is not None
    assert combined.tolist() == [2, 1, 2, 1, 1]
    assert combine_quality_flags(None, extra).tolist() == extra.tolist()
    assert combine_quality_flags(primary, None).tolist() == primary.tolist()


def test_12_year_candidate_also_uses_2001_2024_quality_layer() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=20, value=contract.TREND_INCREASE)
    layers = _layers(classes)
    current = np.zeros(SHAPE, dtype=np.int8)
    full_window = np.zeros(SHAPE, dtype=np.int8)
    full_window[90, 100:110] = 1
    combined = combine_quality_flags(current, full_window)

    candidates = trend_candidates(
        layers,
        "precipitation",
        "2013-2024",
        mask=_mask(),
        quality_flag=combined,
        quality_check_windows=("2013-2024", "2001-2024"),
        min_cluster_cells=10,
    )

    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["cells"] == 10
    assert candidate["flagged_fraction"] == pytest.approx(0.5)
    assert candidate["quality_check_windows"] == ["2013-2024", "2001-2024"]
    cases_file = build_cases_file([candidate], _registry())
    assert EARLY_WINDOW_QUALITY_LIMITATION in cases_file["cases"][0]["limitations"]


def test_full_window_is_preferred_when_scores_are_within_20_percent() -> None:
    short = _manual_candidate("air_temperature", "2013-2024", score=1.2)
    full = _manual_candidate("air_temperature", "2001-2024", score=1.0)

    selected = select_cases(
        [short, full], max_cases=1, target_cases=1
    )

    assert len(selected) == 1
    assert selected[0]["window"] == "2001-2024"


def test_full_window_does_not_win_when_short_score_is_more_than_20_percent_higher() -> None:
    short = _manual_candidate("air_temperature", "2013-2024", score=1.4)
    full = _manual_candidate("air_temperature", "2001-2024", score=1.0)

    selected = select_cases(
        [short, full], max_cases=1, target_cases=1
    )

    assert len(selected) == 1
    assert selected[0]["window"] == "2013-2024"


def test_specific_humidity_2001_2012_is_downweighted() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=20, value=contract.TREND_INCREASE)
    layers = _layers(classes)

    humidity = trend_candidates(
        layers, "specific_humidity", "2001-2012", mask=_mask()
    )[0]
    temperature = trend_candidates(
        layers, "air_temperature", "2001-2012", mask=_mask()
    )[0]

    assert humidity["score_adjustment"] == pytest.approx(0.5)
    assert humidity["score"] == pytest.approx(temperature["score"] * 0.5)
    assert "REAL_RUN_REVIEW" in humidity["score_adjustment_reason"]


def test_southeast_asia_prefers_vietnam_over_mekong() -> None:
    regions = [
        {"id": "mekong", "label": "Mekong", "bbox": [97, 8, 110, 34]},
        {"id": "southeast_asia", "label": "Southeast Asia", "bbox": [92, -11, 141, 29]},
    ]
    vietnam = _manual_candidate(
        "specific_humidity",
        "2001-2024",
        score=1.0,
        kind="country",
        country_id="country_704",
        label="Vietnam",
        bbox=[102.1, 8.6, 109.5, 23.3],
        center=(16.0, 106.0),
    )
    mekong = _manual_candidate(
        "air_temperature",
        "2001-2024",
        score=100.0,
        label="Mekong",
        bbox=[100.0, 10.0, 105.0, 15.0],
        center=(12.0, 102.0),
    )

    selected = select_cases(
        [mekong, vietnam],
        max_cases=1,
        target_cases=1,
        regions=regions,
        preferred_country_ids=("country_704",),
    )

    assert len(selected) == 1
    assert selected[0]["country_id"] == "country_704"


def test_southeast_asia_slot_requires_fifteen_cells() -> None:
    regions = [
        {"id": "mekong", "label": "Mekong", "bbox": [97, 8, 110, 34]},
        {"id": "southeast_asia", "label": "Southeast Asia", "bbox": [92, -11, 141, 29]},
    ]
    too_small = _manual_candidate(
        "specific_humidity",
        "2001-2024",
        cells=14,
        kind="country",
        country_id="country_704",
        label="Vietnam",
        bbox=[102.1, 8.6, 109.5, 23.3],
        center=(16.0, 106.0),
    )
    mekong = _manual_candidate(
        "air_temperature",
        "2001-2024",
        score=1.0,
        label="Mekong",
        bbox=[100.0, 10.0, 105.0, 15.0],
        center=(12.0, 102.0),
    )

    selected = select_cases(
        [too_small, mekong],
        max_cases=1,
        target_cases=1,
        regions=regions,
        preferred_country_ids=("country_704",),
        min_place_cells=15,
    )

    assert len(selected) == 1
    assert selected[0]["variable"] == "air_temperature"


def test_at_least_one_imerg_precipitation_case_is_kept() -> None:
    warm = _manual_candidate("air_temperature", "2001-2024", score=100.0)
    rain = _manual_candidate("precipitation", "2001-2024", score=0.1)

    selected = select_cases([warm, rain], max_cases=2, target_cases=2)

    assert any(case["variable"] == "precipitation" for case in selected)

def test_summary_is_plain_and_why_selected_equals_summary() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=20, value=contract.TREND_DECREASE)
    layers = _layers(classes, slope=-42.0)
    candidate = trend_candidates(
        layers, "precipitation", "2013-2024", mask=_mask()
    )[0]
    cases_file = build_cases_file([candidate], _registry())
    case = cases_file["cases"][0]

    assert case["summary"] == case["why_selected"]
    assert case["summary"].startswith("Since 2013")
    assert case["summary"].endswith(".")
    for forbidden in ("score", "Score", "q =", "median q", "cos-latitude", "REAL_RUN_REVIEW"):
        assert forbidden not in case["summary"]
    assert "details" in case
    assert "Score" in case["details"]


def test_dominant_country_label_uses_top_two_when_they_share_most_cells() -> None:
    grid = np.full(SHAPE, contract.COUNTRY_NONE, dtype=np.int16)
    grid[90, 100:140] = 1  # Alpha
    grid[90, 140:170] = 2  # Beta
    candidate = {
        "kind": "global",
        "rows": np.array([90] * 70),
        "cols": np.arange(100, 170),
    }
    countries = [
        {"index": 1, "label": "Alpha"},
        {"index": 2, "label": "Beta"},
    ]

    assert dominant_country_label(candidate, countries, grid) == "Alpha and Beta"


def test_dominant_country_label_uses_single_country_when_it_dominates() -> None:
    grid = np.full(SHAPE, contract.COUNTRY_NONE, dtype=np.int16)
    grid[90, 100:180] = 3
    candidate = {
        "kind": "global",
        "rows": np.array([90] * 80),
        "cols": np.arange(100, 180),
    }
    countries = [{"index": 3, "label": "Gamma"}]

    assert dominant_country_label(candidate, countries, grid) == "Gamma"


def test_region_label_and_title_use_country_grid() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=20, value=contract.TREND_INCREASE)
    candidate = trend_candidates(
        _layers(classes), "surface_soil_moisture", "2001-2024", mask=_mask()
    )[0]
    grid = np.full(SHAPE, contract.COUNTRY_NONE, dtype=np.int16)
    grid[90, 100:120] = 4
    countries = [{"index": 4, "label": "Testland"}]

    cases_file = build_cases_file(
        [candidate], _registry(), countries=countries, country_grid=grid
    )
    case = cases_file["cases"][0]

    assert case["region"]["label"] == "Testland"
    assert "Testland" in case["title"]


def test_caution_candidate_keeps_flagged_cells_in_the_country_domain() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=20, value=contract.TREND_INCREASE)
    layers = _layers(classes, slope=0.5)
    grid = np.full(SHAPE, contract.COUNTRY_NONE, dtype=np.int16)
    grid[90, 100:120] = 7
    quality = np.zeros(SHAPE, dtype=np.int8)
    quality[90, 100:112] = 1
    breakpoints = np.full(SHAPE, np.nan, dtype=float)
    breakpoints[90, 100:112] = 2012.0
    country = {"index": 7, "id": "country_999", "label": "Testland"}

    candidate, reason = build_caution_candidate(
        layers,
        "air_temperature",
        "2001-2024",
        country,
        grid,
        mask=_mask(),
        quality_flag=quality,
        breakpoint_year=breakpoints,
        min_cells=15,
    )

    assert candidate is not None, reason
    assert candidate["kind"] == "caution"
    assert candidate["cells"] == 20  # flagged cells are not excluded
    assert candidate["quality_flag_share"] == pytest.approx(12 / 20)
    assert candidate["break_year"] == pytest.approx(2012.0)
    assert candidate["evidence"][0]["sen_slope_decade"] == pytest.approx(0.5)


def test_caution_candidate_rejected_when_not_significant() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=4, value=contract.TREND_INCREASE)
    layers = _layers(classes, slope=0.5)
    grid = np.full(SHAPE, contract.COUNTRY_NONE, dtype=np.int16)
    grid[90, 100:120] = 7
    quality = np.zeros(SHAPE, dtype=np.int8)
    country = {"index": 7, "id": "country_999", "label": "Testland"}

    candidate, reason = build_caution_candidate(
        layers,
        "air_temperature",
        "2001-2024",
        country,
        grid,
        mask=_mask(),
        quality_flag=quality,
        min_cells=15,
    )

    assert candidate is None
    assert "significant" in reason


def test_caution_summary_names_trend_flags_and_gldas_change() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=20, value=contract.TREND_INCREASE)
    layers = _layers(classes, slope=0.5)
    grid = np.full(SHAPE, contract.COUNTRY_NONE, dtype=np.int16)
    grid[90, 100:120] = 7
    quality = np.zeros(SHAPE, dtype=np.int8)
    quality[90, 100:112] = 1
    breakpoints = np.full(SHAPE, np.nan, dtype=float)
    breakpoints[90, 100:112] = 2012.0
    country = {"index": 7, "id": "country_999", "label": "Testland"}
    candidate, _ = build_caution_candidate(
        layers,
        "air_temperature",
        "2001-2024",
        country,
        grid,
        mask=_mask(),
        quality_flag=quality,
        breakpoint_year=breakpoints,
        min_cells=15,
    )
    assert candidate is not None
    case = build_cases_file([candidate], _registry())[ "cases"][0]

    assert case["kind"] == "caution"
    assert case["summary"] == case["why_selected"]
    assert "60%" in case["summary"]
    assert "GLDAS 2008" in case["summary"]
    assert "caution" in case["summary"].lower()
    assert "score" not in case["summary"].lower()
    assert "q =" not in case["summary"]

def test_label_uses_one_country_when_it_holds_at_least_half() -> None:
    grid = np.full(SHAPE, contract.COUNTRY_NONE, dtype=np.int16)
    rows: list[int] = []
    cols: list[int] = []
    col = 0
    for index, count in ((1, 55), (2, 14), (3, 11), (4, 10), (5, 10)):
        for _ in range(count):
            grid[90, col] = index
            rows.append(90)
            cols.append(col)
            col += 1
    candidate = {"kind": "global", "rows": np.asarray(rows), "cols": np.asarray(cols)}
    countries = [
        {"index": 1, "iso_numeric": "710", "label": "South Africa"},
        {"index": 2, "iso_numeric": "024", "label": "Angola"},
        {"index": 3, "iso_numeric": "156", "label": "China"},
        {"index": 4, "iso_numeric": "516", "label": "Namibia"},
        {"index": 5, "iso_numeric": "894", "label": "Zambia"},
    ]

    assert dominant_country_label(candidate, countries, grid) == "South Africa"


def test_label_uses_two_countries_when_they_hold_at_least_seventy_percent() -> None:
    grid = np.full(SHAPE, contract.COUNTRY_NONE, dtype=np.int16)
    rows: list[int] = []
    cols: list[int] = []
    col = 0
    for index, count in ((1, 40), (2, 30), (3, 30)):
        for _ in range(count):
            grid[90, col] = index
            rows.append(90)
            cols.append(col)
            col += 1
    candidate = {"kind": "global", "rows": np.asarray(rows), "cols": np.asarray(cols)}
    countries = [
        {"index": 1, "iso_numeric": "710", "label": "South Africa"},
        {"index": 2, "iso_numeric": "024", "label": "Angola"},
        {"index": 3, "iso_numeric": "156", "label": "China"},
    ]

    assert dominant_country_label(candidate, countries, grid) == "South Africa and Angola"


def test_label_falls_back_to_one_m49_subregion() -> None:
    grid = np.full(SHAPE, contract.COUNTRY_NONE, dtype=np.int16)
    rows: list[int] = []
    cols: list[int] = []
    col = 0
    for index, count in ((1, 35), (2, 20), (3, 20), (4, 25)):
        for _ in range(count):
            grid[90, col] = index
            rows.append(90)
            cols.append(col)
            col += 1
    candidate = {"kind": "global", "rows": np.asarray(rows), "cols": np.asarray(cols)}
    countries = [
        {"index": 1, "iso_numeric": "710", "label": "South Africa"},
        {"index": 2, "iso_numeric": "516", "label": "Namibia"},
        {"index": 3, "iso_numeric": "024", "label": "Angola"},
        {"index": 4, "iso_numeric": "894", "label": "Zambia"},
    ]

    assert dominant_country_label(candidate, countries, grid) == "Southern Africa"


def test_label_joins_two_m49_subregions_when_they_share_most_cells() -> None:
    grid = np.full(SHAPE, contract.COUNTRY_NONE, dtype=np.int16)
    rows: list[int] = []
    cols: list[int] = []
    col = 0
    for index, count in ((1, 25), (2, 20), (3, 15), (4, 15), (5, 25)):
        for _ in range(count):
            grid[90, col] = index
            rows.append(90)
            cols.append(col)
            col += 1
    candidate = {"kind": "global", "rows": np.asarray(rows), "cols": np.asarray(cols)}
    countries = [
        {"index": 1, "iso_numeric": "710", "label": "South Africa"},
        {"index": 2, "iso_numeric": "516", "label": "Namibia"},
        {"index": 3, "iso_numeric": "024", "label": "Angola"},
        {"index": 4, "iso_numeric": "180", "label": "DR Congo"},
        {"index": 5, "iso_numeric": "894", "label": "Zambia"},
    ]

    assert (
        dominant_country_label(candidate, countries, grid)
        == "Southern Africa and Middle Africa"
    )


def test_label_returns_none_without_country_cells_for_coordinate_fallback() -> None:
    grid = np.full(SHAPE, contract.COUNTRY_NONE, dtype=np.int16)
    candidate = {
        "kind": "global",
        "rows": np.array([90] * 20),
        "cols": np.arange(100, 120),
    }
    countries = [{"index": 1, "iso_numeric": "710", "label": "South Africa"}]

    assert dominant_country_label(candidate, countries, grid) is None


def test_caution_limitation_says_flags_are_included() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=20, value=contract.TREND_INCREASE)
    layers = _layers(classes, slope=0.5)
    grid = np.full(SHAPE, contract.COUNTRY_NONE, dtype=np.int16)
    grid[90, 100:120] = 7
    quality = np.zeros(SHAPE, dtype=np.int8)
    quality[90, 100:112] = 1
    country = {"index": 7, "id": "country_999", "label": "Testland"}
    candidate, _ = build_caution_candidate(
        layers,
        "air_temperature",
        "2001-2024",
        country,
        grid,
        mask=_mask(),
        quality_flag=quality,
        min_cells=15,
    )
    assert candidate is not None
    limitations = " ".join(build_cases_file([candidate], _registry())["cases"][0]["limitations"])

    assert "included on purpose" in limitations
    assert "excluded from the evidence" not in limitations


def test_finding_limitation_says_flags_are_excluded() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=20, value=contract.TREND_INCREASE)
    quality = np.zeros(SHAPE, dtype=np.int8)
    quality[90, 100:105] = 1
    candidate = trend_candidates(
        _layers(classes),
        "surface_soil_moisture",
        "2001-2024",
        mask=_mask(),
        quality_flag=quality,
        min_cluster_cells=15,
    )[0]
    limitations = " ".join(build_cases_file([candidate], _registry())["cases"][0]["limitations"])

    assert "excluded from the evidence" in limitations
    assert "included on purpose" not in limitations
