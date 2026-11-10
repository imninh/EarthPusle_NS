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
    build_global_caution_candidate,
    cluster_components,
    combine_quality_flags,
    country_candidates,
    dominant_country_label,
    dumps_cases,
    pattern_candidates,
    select_cases,
    trend_candidates,
    witness_agreement_grid,
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
    candidates = trend_candidates(
        layers,
        "precipitation",
        "2001-2024",
        mask=_mask(),
        witness_layers=_witness_constant(contract.WITNESS_CORROBORATED),
    )

    notes: list[str] = []
    selected = select_cases(
        candidates, max_cases=6, target_cases=4, selection_notes=notes
    )

    pair = [case for case in selected if case["role"].startswith("opposite-pair")]
    assert len(pair) == 2
    assert {case["trend_class"] for case in pair} == {
        contract.TREND_INCREASE,
        contract.TREND_DECREASE,
    }
    assert {case["variable"] for case in pair} == {"precipitation"}
    assert notes == []


def test_opposite_pair_requires_witness_code_2_on_both_sides() -> None:
    increasing_classes = _classes()
    _blob(
        increasing_classes,
        row=90,
        col=100,
        height=1,
        width=20,
        value=contract.TREND_INCREASE,
    )
    decreasing_classes = _classes()
    _blob(
        decreasing_classes,
        row=100,
        col=100,
        height=1,
        width=20,
        value=contract.TREND_DECREASE,
    )
    increasing = trend_candidates(
        _layers(increasing_classes),
        "precipitation",
        "2001-2024",
        mask=_mask(),
        witness_layers=_witness_constant(contract.WITNESS_CORROBORATED),
    )
    decreasing = trend_candidates(
        _layers(decreasing_classes),
        "precipitation",
        "2001-2024",
        mask=_mask(),
        witness_layers=_witness_constant(contract.WITNESS_SAME_SIGN, q=0.2),
    )

    notes: list[str] = []
    selected = select_cases(
        increasing + decreasing,
        max_cases=6,
        target_cases=4,
        selection_notes=notes,
    )

    assert not any(case["role"].startswith("opposite-pair") for case in selected)
    assert any("Opposite pair skipped" in note for note in notes)
    assert any("not 2" in note or "contradicted" in note for note in notes)


def test_opposite_pair_prefers_precipitation() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=20, value=contract.TREND_INCREASE)
    _blob(classes, row=100, col=100, height=1, width=20, value=contract.TREND_DECREASE)
    layers = _layers(classes)
    witness = _witness_constant(contract.WITNESS_CORROBORATED)
    rain = trend_candidates(
        layers, "precipitation", "2001-2024", mask=_mask(), witness_layers=witness
    )
    air = trend_candidates(
        layers, "air_temperature", "2001-2024", mask=_mask(), witness_layers=witness
    )

    selected = select_cases(rain + air, max_cases=6, target_cases=4)
    pair = [case for case in selected if case["role"].startswith("opposite-pair")]
    assert {case["variable"] for case in pair} == {"precipitation"}


def test_opposite_pair_rejects_the_same_place_label() -> None:
    def pair_side(trend_class: int, label: str) -> dict:
        candidate = _manual_candidate(
            "precipitation",
            "2001-2024",
            trend_class=trend_class,
            label=label,
        )
        candidate["evidence"] = [
            {
                "variable": "precipitation",
                "witness": {"agreement": contract.WITNESS_CORROBORATED},
            }
        ]
        candidate["witness_contradicted_share"] = 0.05
        return candidate

    notes: list[str] = []
    selected = select_cases(
        [pair_side(1, "Same place"), pair_side(-1, "Same place")],
        max_cases=6,
        target_cases=4,
        selection_notes=notes,
    )
    assert not any(case["role"].startswith("opposite-pair") for case in selected)
    assert any("both sides are labelled" in note for note in notes)


def test_global_humidity_caution_uses_witness_disagreement() -> None:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=20, value=contract.TREND_DECREASE)
    layers = _layers(classes, slope=-0.2)
    witness_classes = _classes()
    _blob(
        witness_classes,
        row=90,
        col=100,
        height=1,
        width=20,
        value=contract.TREND_INCREASE,
    )
    quality = np.zeros(SHAPE, dtype=np.int8)
    candidate, reason = build_global_caution_candidate(
        layers,
        "specific_humidity",
        "2001-2024",
        _mask(),
        quality_flag=quality,
        witness_layers={
            "trend_class": witness_classes,
            "agreement": np.full(SHAPE, contract.WITNESS_CONTRADICTED, dtype=np.int8),
            "sen_slope_decade": np.full(SHAPE, 0.2),
            "q_value": np.full(SHAPE, 0.01),
        },
        min_cells=15,
        screener_contradicted_fraction=0.39327739669298556,
    )
    assert candidate is not None, reason
    assert candidate["caution_type"] == "witness_disagreement"
    assert candidate["witness_contradicted_share"] == pytest.approx(
        0.39327739669298556
    )
    weights = np.cos(np.deg2rad(contract.row_to_lat(90)))
    total_weight = (
        np.cos(np.deg2rad(np.arange(89.5, -90.0, -1.0))).sum()
        * contract.N_COLS
    )
    assert candidate["main_decrease_fraction"] == pytest.approx(
        20 * weights / total_weight
    )
    assert candidate["witness_increase_fraction"] == pytest.approx(
        20 * weights / total_weight
    )

    case = build_cases_file([candidate], _registry())["cases"][0]
    assert case["kind"] == "caution"
    assert case["title"] == "Is the air drying? The second witness says no"
    assert case["region"]["id"] == "global"
    assert case["region"]["bbox"] == [-180.0, -60.0, 180.0, 90.0]
    assert "falls across" in case["summary"]
    assert "rises across" in case["summary"]
    assert "39.3%" in case["summary"]
    assert "of GLDAS's significant area" in case["summary"]
    limitations = " ".join(case["limitations"])
    assert "A country domain follows" not in limitations
    assert "Witness rule:" not in case["details"]

    registry = _registry()
    registry["variables"].append(
        {
            "id": "specific_humidity",
            "label": "Specific humidity",
            "product": "GLDAS_NOAH10_M",
            "slope_unit": "g kg-1 per year",
            "caveats": ["Meteorological forcing field used to drive the GLDAS model."],
        }
    )
    case = build_cases_file([candidate], registry)["cases"][0]
    limitations = " ".join(case["limitations"])
    assert (
        "Specific humidity is a GLDAS forcing input, so the documented "
        "2008\N{EN DASH}2012 input change acts on it directly."
    ) in limitations
    assert "Meteorological forcing field used to drive the GLDAS model." not in limitations


def test_vietnam_caution_adds_lasting_shift_to_summary_and_details() -> None:
    layers, grid, quality, breakpoints, country = _caution_inputs()
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
        witness_layers=_witness_constant(
            contract.WITNESS_SAME_SIGN, slope=0.14, q=0.20
        ),
    )
    assert candidate is not None, reason
    candidate["lasting_shift"] = {
        "break_year": 2012.0,
        "main": 0.73,
        "witness": 0.12,
        "annual_correlation": 0.61,
    }
    case = build_cases_file([candidate], _registry())["cases"][0]
    assert case["region"]["id"] == "country_999"
    assert "0.50" in case["summary"]  # synthetic GLDAS slope, computed
    assert "60%" in case["summary"]
    assert "2012" in case["summary"]
    assert "+0.14" in case["summary"]
    assert "+0.12" in case["summary"]
    assert "+0.73" in case["summary"]
    assert "not significant" in case["summary"]
    assert "Lasting shift at 2012" in case["details"]
    assert "vs witness +0.12" in case["details"]



def test_emitted_bbox_is_not_reversed_without_a_dateline_crossing() -> None:
    classes = _classes()
    _blob(classes, row=90, col=190, height=1, width=15, value=contract.TREND_INCREASE)
    candidate = trend_candidates(
        _layers(classes), "precipitation", "2001-2024", mask=_mask()
    )[0]
    candidate["bbox"] = [10.0, 0.0, -10.0, 10.0]  # deliberately wrong
    case = build_cases_file([candidate], _registry())["cases"][0]
    assert case["region"]["bbox"][0] <= case["region"]["bbox"][2]


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


def _witness_constant(code: int, *, slope: float = 0.25, q: float = 0.01) -> dict[str, np.ndarray]:
    return {
        "agreement": np.full(SHAPE, code, dtype=np.int8),
        "sen_slope_decade": np.full(SHAPE, slope, dtype=float),
        "q_value": np.full(SHAPE, q, dtype=float),
    }


def _increasing_blob() -> np.ndarray:
    classes = _classes()
    _blob(classes, row=90, col=100, height=1, width=20, value=contract.TREND_INCREASE)
    return classes


def _caution_inputs() -> tuple:
    classes = _increasing_blob()
    layers = _layers(classes, slope=0.5)
    grid = np.full(SHAPE, contract.COUNTRY_NONE, dtype=np.int16)
    grid[90, 100:120] = 7
    quality = np.zeros(SHAPE, dtype=np.int8)
    quality[90, 100:112] = 1
    breakpoints = np.full(SHAPE, np.nan, dtype=float)
    breakpoints[90, 100:112] = 2012.0
    country = {"index": 7, "id": "country_999", "label": "Testland"}
    return layers, grid, quality, breakpoints, country


def test_witness_agreement_codes_match_the_contract() -> None:
    main_class = _classes()
    witness_class = _classes()
    main_slope = np.zeros(SHAPE, dtype=float)
    witness_slope = np.zeros(SHAPE, dtype=float)
    main_q = np.ones(SHAPE, dtype=float)
    witness_q = np.ones(SHAPE, dtype=float)
    mask = _mask()

    # 2: both significant, same sign.
    main_slope[90, 100] = 1.0
    witness_slope[90, 100] = 0.4
    main_q[90, 100] = 0.01
    witness_q[90, 100] = 0.01
    # 1: same sign, witness not significant.
    main_slope[90, 101] = 1.0
    witness_slope[90, 101] = 0.2
    main_q[90, 101] = 0.01
    witness_q[90, 101] = 0.20
    # -1: opposite sign, witness not significant.
    main_slope[90, 102] = 1.0
    witness_slope[90, 102] = -0.2
    main_q[90, 102] = 0.01
    witness_q[90, 102] = 0.20
    # -2: both significant, opposite sign.
    main_slope[90, 103] = 1.0
    witness_slope[90, 103] = -0.4
    main_q[90, 103] = 0.01
    witness_q[90, 103] = 0.01
    # 0: main trend not significant.
    main_slope[90, 104] = 1.0
    witness_slope[90, 104] = 1.0
    main_q[90, 104] = 0.20
    witness_q[90, 104] = 0.01
    # -9: main series was not evaluated.
    main_class[90, 105] = contract.INSUFFICIENT_DATA
    main_slope[90, 105] = np.nan
    main_q[90, 105] = np.nan
    # -99: outside the analysis mask.
    mask[90, 106] = False
    main_slope[90, 106] = 1.0
    witness_slope[90, 106] = 1.0
    main_q[90, 106] = 0.01
    witness_q[90, 106] = 0.01

    codes = witness_agreement_grid(
        {
            "trend_class": main_class,
            "sen_slope_decade": main_slope,
            "q_value": main_q,
        },
        {
            "trend_class": witness_class,
            "sen_slope_decade": witness_slope,
            "q_value": witness_q,
        },
        mask,
    )

    assert int(codes[90, 100]) == contract.WITNESS_CORROBORATED
    assert int(codes[90, 101]) == contract.WITNESS_SAME_SIGN
    assert int(codes[90, 102]) == contract.WITNESS_OPPOSITE_SIGN
    assert int(codes[90, 103]) == contract.WITNESS_CONTRADICTED
    assert int(codes[90, 104]) == contract.WITNESS_MAIN_NOT_SIGNIFICANT
    assert int(codes[90, 105]) == contract.INSUFFICIENT_DATA
    assert int(codes[90, 106]) == contract.OUTSIDE_DOMAIN


def test_agreeing_witness_uses_median_slope_median_q_and_majority_code() -> None:
    classes = _increasing_blob()
    layers = _layers(classes, slope=1.0, q=0.01)
    agreement = np.full(SHAPE, contract.OUTSIDE_DOMAIN, dtype=np.int8)
    agreement[90, 100:112] = contract.WITNESS_CORROBORATED
    agreement[90, 112:120] = contract.WITNESS_SAME_SIGN
    slopes = np.arange(1.0, 21.0)
    witness_slope = np.full(SHAPE, np.nan)
    witness_slope[90, 100:120] = slopes
    witness_q = np.full(SHAPE, np.nan)
    witness_q[90, 100:120] = np.linspace(0.001, 0.02, 20)
    weights = np.full(20, np.cos(np.deg2rad(contract.row_to_lat(90))))

    candidate = trend_candidates(
        layers,
        "air_temperature",
        "2001-2024",
        mask=_mask(),
        witness_layers={
            "agreement": agreement,
            "sen_slope_decade": witness_slope,
            "q_value": witness_q,
        },
    )[0]
    bare = trend_candidates(
        layers, "air_temperature", "2001-2024", mask=_mask()
    )[0]
    witness = candidate["evidence"][0]["witness"]

    assert witness["agreement"] == contract.WITNESS_CORROBORATED
    assert witness["sen_slope_decade"] == pytest.approx(weighted_median(slopes, weights))
    assert witness["q_value"] == pytest.approx(
        weighted_median(witness_q[90, 100:120], weights)
    )
    assert witness["product"] == "MERRA-2 M2TMNXSLV 5.12.4"
    assert witness["variable"] == "T2M"
    assert witness["slope_unit"] == "degC per decade"
    assert candidate["witness_corroborated_share"] == pytest.approx(12 / 20)
    assert candidate["witness_score_factor"] == pytest.approx(0.5 + 0.5 * 12 / 20)
    assert candidate["score"] == pytest.approx(bare["score"] * candidate["witness_score_factor"])

    case = build_cases_file([candidate], _registry())["cases"][0]
    published = case["evidence"][0]["witness"]
    assert set(published) == {
        "product",
        "variable",
        "sen_slope_decade",
        "slope_unit",
        "q_value",
        "agreement",
    }
    assert published["agreement"] == 2
    assert "MERRA-2 is also a model (reanalysis)" in " ".join(case["limitations"])


def test_witness_agreement_is_computed_when_the_export_grid_is_absent() -> None:
    classes = _increasing_blob()
    main = _layers(classes, slope=1.0, q=0.01)
    witness_class = _classes()
    _blob(
        witness_class,
        row=90,
        col=100,
        height=1,
        width=20,
        value=contract.TREND_INCREASE,
    )
    candidate = trend_candidates(
        main,
        "precipitation",
        "2001-2024",
        mask=_mask(),
        witness_layers={
            "trend_class": witness_class,
            "sen_slope_decade": np.full(SHAPE, 0.25),
            "q_value": np.full(SHAPE, 0.01),
        },
    )[0]
    witness = candidate["evidence"][0]["witness"]

    assert witness["agreement"] == contract.WITNESS_CORROBORATED
    assert witness["sen_slope_decade"] == pytest.approx(0.25)
    assert witness["product"] == "GPCP GPCPMON 3.3"
    assert witness["variable"] == "sat_gauge_precip"
    assert witness["slope_unit"] == "mm/month per decade"
    limitations = " ".join(build_cases_file([candidate], _registry())["cases"][0]["limitations"])
    assert "GPCP shares rain-gauge inputs with IMERG" in limitations


def test_corroborated_cluster_wins_an_equal_raw_score() -> None:
    classes = _increasing_blob()
    layers = _layers(classes)
    agreed = trend_candidates(
        layers,
        "air_temperature",
        "2001-2024",
        mask=_mask(),
        witness_layers=_witness_constant(contract.WITNESS_CORROBORATED),
    )[0]
    uncorroborated = trend_candidates(
        layers,
        "surface_skin_temperature",
        "2001-2024",
        mask=_mask(),
        witness_layers=_witness_constant(contract.WITNESS_SAME_SIGN, q=0.2),
    )[0]

    assert agreed["witness_score_factor"] == pytest.approx(1.0)
    assert uncorroborated["witness_score_factor"] == pytest.approx(0.5)
    assert agreed["score"] == pytest.approx(uncorroborated["score"] * 2.0)

    selected = select_cases(
        [uncorroborated, agreed], max_cases=1, target_cases=1
    )

    assert len(selected) == 1
    assert selected[0]["variable"] == "air_temperature"


def test_mostly_contradicted_finding_is_not_selected() -> None:
    classes = _increasing_blob()
    contradicted = trend_candidates(
        _layers(classes, std=5.0),
        "air_temperature",
        "2001-2024",
        mask=_mask(),
        witness_layers=_witness_constant(
            contract.WITNESS_CONTRADICTED, slope=-0.4
        ),
    )[0]
    corroborated = trend_candidates(
        _layers(classes, std=0.1),
        "specific_humidity",
        "2001-2024",
        mask=_mask(),
        witness_layers=_witness_constant(contract.WITNESS_CORROBORATED),
    )[0]

    assert contradicted["witness_contradicted_share"] == pytest.approx(1.0)
    assert contradicted["score"] > corroborated["score"]

    selected = select_cases(
        [contradicted, corroborated], max_cases=1, target_cases=1
    )

    assert len(selected) == 1
    assert selected[0]["variable"] == "specific_humidity"


def test_contradicted_share_of_exactly_half_is_still_eligible() -> None:
    classes = _increasing_blob()
    agreement = np.full(SHAPE, contract.WITNESS_CONTRADICTED, dtype=np.int8)
    agreement[90, 100:110] = contract.WITNESS_CORROBORATED
    candidate = trend_candidates(
        _layers(classes),
        "air_temperature",
        "2001-2024",
        mask=_mask(),
        witness_layers={
            "agreement": agreement,
            "sen_slope_decade": np.full(SHAPE, 0.2),
            "q_value": np.full(SHAPE, 0.01),
        },
    )[0]

    assert candidate["witness_contradicted_share"] == pytest.approx(0.5)
    selected = select_cases([candidate], max_cases=1, target_cases=1)
    assert len(selected) == 1
    assert selected[0]["variable"] == "air_temperature"


def test_missing_witness_does_not_change_the_score_or_evidence() -> None:
    classes = _increasing_blob()
    layers = _layers(classes)
    candidate = trend_candidates(
        layers, "precipitation", "2001-2024", mask=_mask()
    )[0]
    case = build_cases_file([candidate], _registry())

    assert "witness" not in candidate["evidence"][0]
    assert candidate["witness_corroborated_share"] is None
    assert candidate["witness_contradicted_share"] is None
    assert candidate["witness_score_factor"] == pytest.approx(1.0)
    assert "witness" not in case["cases"][0]["evidence"][0]
    assert "Witness rule: no witness agreement layer" in case["cases"][0]["details"]
    assert "0.5 + 0.5 x corroborated share" in case["selection_method"]
    assert "agreement code -2 share above 50%" in case["selection_method"]


def test_caution_summary_adds_a_corroborating_witness_verdict() -> None:
    layers, grid, quality, breakpoints, country = _caution_inputs()
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
        witness_layers=_witness_constant(contract.WITNESS_CORROBORATED, slope=0.3, q=0.02),
    )
    assert candidate is not None, reason
    case = build_cases_file([candidate], _registry())["cases"][0]

    assert case["kind"] == "caution"
    assert "sudden shift around 2012" in case["summary"]
    assert "GLDAS 2008" in case["summary"]
    assert (
        "MERRA-2 reanalysis shows the same warming, so the trend is more likely real."
        in case["summary"]
    )
    assert "score" not in case["summary"].lower()
    assert case["evidence"][0]["witness"]["agreement"] == 2
    assert case["evidence"][0]["witness"]["sen_slope_decade"] == pytest.approx(0.3)
    assert "Witness rule:" not in case["details"]
    assert "MERRA-2 is also a model (reanalysis)" in " ".join(case["limitations"])
    # Caution cases are not ranking findings, so the score is not scaled.
    assert candidate["witness_score_factor"] == pytest.approx(1.0)


def test_caution_summary_adds_a_contradicting_witness_verdict() -> None:
    layers, grid, quality, breakpoints, country = _caution_inputs()
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
        witness_layers=_witness_constant(
            contract.WITNESS_CONTRADICTED, slope=-0.2, q=0.01
        ),
    )
    assert candidate is not None, reason
    summary = build_cases_file([candidate], _registry())["cases"][0]["summary"]

    assert candidate["evidence"][0]["witness"]["agreement"] == contract.WITNESS_CONTRADICTED
    assert (
        "MERRA-2 reanalysis does not show the same warming, so the trend is "
        "more likely a data artefact."
    ) in summary
    assert "more likely real" not in summary


def test_pattern_finding_uses_the_weakest_witness_and_can_be_rejected() -> None:
    temperature = _classes()
    moisture = _classes()
    _blob(temperature, row=90, col=100, height=2, width=10, value=contract.TREND_INCREASE)
    _blob(moisture, row=90, col=100, height=2, width=10, value=contract.TREND_DECREASE)
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
        witness_by_variable={
            "surface_skin_temperature": _witness_constant(contract.WITNESS_CORROBORATED),
            "root_zone_soil_moisture": _witness_constant(
                contract.WITNESS_CONTRADICTED, slope=-0.1
            ),
        },
    )

    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["witness_corroborated_share"] == pytest.approx(0.0)
    assert candidate["witness_contradicted_share"] == pytest.approx(1.0)
    assert [item["witness"]["agreement"] for item in candidate["evidence"]] == [
        contract.WITNESS_CORROBORATED,
        contract.WITNESS_CONTRADICTED,
    ]
    assert select_cases([candidate], max_cases=2, target_cases=1) == []
