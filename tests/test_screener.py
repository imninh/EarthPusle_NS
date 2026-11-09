"""Tests for the P03b Variable Screener metrics.

All grids are synthetic and built inside the tests; no EarthPulse data values
are used. Run with ``.venv/Scripts/python -m pytest``.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from earthpulse import contract
from earthpulse.screener import (
    domain_mask,
    screener_row,
    screener_table,
    weighted_median,
)

SHAPE = (contract.N_ROWS, contract.N_COLS)
ROW_KEYS = {
    "variable",
    "valid_area_fraction",
    "sig_increase_area_fraction",
    "sig_decrease_area_fraction",
    "median_abs_std_change_decade",
    "median_sen_slope_decade_sig",
    "regional_contrast",
    "n_cells_evaluated",
}


def _classes(fill: int = 0) -> np.ndarray:
    return np.full(SHAPE, fill, dtype=np.int8)


def _domain() -> np.ndarray:
    return np.ones(SHAPE, dtype=bool)


def _row_domain(row: int) -> np.ndarray:
    domain = np.zeros(SHAPE, dtype=bool)
    domain[row, :] = True
    return domain


def _lat_of_row(row: int) -> float:
    return contract.LAT_NORTH_CENTER - row * contract.RESOLUTION_DEG


def test_half_increasing_half_decreasing_equal_area() -> None:
    """Equal areas up and down give up = down = 0.5 and contrast = 0.5."""

    trend_class = _classes()
    trend_class[90, :180] = contract.TREND_INCREASE
    trend_class[90, 180:] = contract.TREND_DECREASE

    std_change = np.full(SHAPE, 0.5)
    sen_slope = np.where(
        trend_class == contract.TREND_INCREASE, 2.0, -2.0
    )

    row = screener_row(
        "synthetic_variable", trend_class, std_change, sen_slope, _row_domain(90)
    )

    assert row["n_cells_evaluated"] == 360
    assert row["valid_area_fraction"] == pytest.approx(1.0)
    assert row["sig_increase_area_fraction"] == pytest.approx(0.5)
    assert row["sig_decrease_area_fraction"] == pytest.approx(0.5)
    assert row["regional_contrast"] == pytest.approx(0.5)
    assert row["median_abs_std_change_decade"] == pytest.approx(0.5)
    # Exact-half tie: the documented rule picks the lower sorted value.
    assert row["median_sen_slope_decade_sig"] == pytest.approx(-2.0)


def test_all_increasing_has_contrast_zero() -> None:
    trend_class = _classes()
    trend_class[90, :] = contract.TREND_INCREASE
    row = screener_row(
        "v",
        trend_class,
        np.full(SHAPE, 1.0),
        np.full(SHAPE, 2.0),
        _row_domain(90),
    )

    assert row["sig_increase_area_fraction"] == pytest.approx(1.0)
    assert row["sig_decrease_area_fraction"] == pytest.approx(0.0)
    assert row["regional_contrast"] == pytest.approx(0.0)
    assert row["median_sen_slope_decade_sig"] == pytest.approx(2.0)


def test_no_significant_cells_gives_null_contrast_and_medians() -> None:
    trend_class = _classes()
    trend_class[90, :] = contract.TREND_NOT_SIGNIFICANT

    row = screener_row(
        "v",
        trend_class,
        np.full(SHAPE, 1.0),
        np.full(SHAPE, 2.0),
        _row_domain(90),
    )

    assert row["n_cells_evaluated"] == 360
    assert row["valid_area_fraction"] == pytest.approx(1.0)
    assert row["sig_increase_area_fraction"] == pytest.approx(0.0)
    assert row["sig_decrease_area_fraction"] == pytest.approx(0.0)
    assert row["regional_contrast"] is None
    assert row["median_abs_std_change_decade"] is None
    assert row["median_sen_slope_decade_sig"] is None


def test_insufficient_data_cells_are_not_evaluated() -> None:
    trend_class = _classes(contract.INSUFFICIENT_DATA)
    trend_class[90, :90] = contract.TREND_INCREASE

    row = screener_row(
        "v",
        trend_class,
        np.full(SHAPE, 1.0),
        np.full(SHAPE, 2.0),
        _row_domain(90),
    )

    assert row["n_cells_evaluated"] == 90
    assert row["valid_area_fraction"] == pytest.approx(0.25)
    assert row["sig_increase_area_fraction"] == pytest.approx(1.0)
    assert row["sig_decrease_area_fraction"] == pytest.approx(0.0)
    assert row["regional_contrast"] == pytest.approx(0.0)


def test_domain_without_evaluated_cells_does_not_crash() -> None:
    trend_class = _classes(contract.INSUFFICIENT_DATA)
    row = screener_row(
        "v",
        trend_class,
        np.full(SHAPE, 1.0),
        np.full(SHAPE, 2.0),
        _domain(),
    )

    assert row["n_cells_evaluated"] == 0
    assert row["valid_area_fraction"] == pytest.approx(0.0)
    assert row["sig_increase_area_fraction"] is None
    assert row["sig_decrease_area_fraction"] is None
    assert row["regional_contrast"] is None
    assert row["median_abs_std_change_decade"] is None
    assert row["median_sen_slope_decade_sig"] is None


def test_area_weighting_matches_cosine() -> None:
    """The same count of cells at 60.5N contributes less than at 0.5N."""

    high_row, low_row = 29, 89  # 60.5N and 0.5N
    domain = np.zeros(SHAPE, dtype=bool)
    domain[high_row, :] = True
    domain[low_row, :] = True

    trend_class = _classes()
    trend_class[high_row, :10] = contract.TREND_INCREASE
    trend_class[low_row, :10] = contract.TREND_INCREASE

    row = screener_row(
        "v",
        trend_class,
        np.full(SHAPE, 1.0),
        np.full(SHAPE, 2.0),
        domain,
    )

    weight_high = np.cos(np.deg2rad(_lat_of_row(high_row)))
    weight_low = np.cos(np.deg2rad(_lat_of_row(low_row)))
    two_rows_area = 360.0 * (weight_high + weight_low)
    expected_fraction = 10.0 * (weight_high + weight_low) / two_rows_area

    assert weight_low > weight_high
    assert row["valid_area_fraction"] == pytest.approx(1.0)
    assert row["sig_increase_area_fraction"] == pytest.approx(expected_fraction)

    # Same number of significant cells in each row: the 0.5N row gets a
    # larger fraction, and the ratio equals the cosine-weight ratio.
    trend_high = _classes()
    trend_high[high_row, :10] = contract.TREND_INCREASE
    trend_low = _classes()
    trend_low[low_row, :10] = contract.TREND_INCREASE

    fraction_high = screener_row(
        "v", trend_high, np.full(SHAPE, 1.0), np.full(SHAPE, 2.0), domain
    )["sig_increase_area_fraction"]
    fraction_low = screener_row(
        "v", trend_low, np.full(SHAPE, 1.0), np.full(SHAPE, 2.0), domain
    )["sig_increase_area_fraction"]

    assert fraction_high is not None and fraction_low is not None
    assert fraction_low > fraction_high
    assert fraction_low / fraction_high == pytest.approx(
        weight_low / weight_high
    )


def test_domain_mask_intersects_box_and_common_mask() -> None:
    common = np.zeros(SHAPE, dtype=bool)
    common[40:60, 100:120] = True  # synthetic land patch

    global_mask = domain_mask("global", common)
    assert np.array_equal(global_mask, common)
    assert global_mask is not common  # caller may mutate the result safely

    # Box fully inside the patch: rows 45..54 (44.5N..35.5N) x cols 105..114.
    inside = domain_mask((-75.0, 35.0, -65.0, 45.0), common)
    assert int(inside.sum()) == 100
    expected = np.zeros(SHAPE, dtype=bool)
    expected[45:55, 105:115] = True
    assert np.array_equal(inside, expected)

    # Box only partly overlaps the patch: rows 40..44 x cols 105..114.
    partial = domain_mask((-75.0, 45.0, -65.0, 55.0), common)
    assert int(partial.sum()) == 50
    expected_partial = np.zeros(SHAPE, dtype=bool)
    expected_partial[40:45, 105:115] = True
    assert np.array_equal(partial, expected_partial)

    # A box over a different latitude band crosses no mask cells.
    empty = domain_mask((0.0, 0.0, 10.0, 10.0), common)
    assert not empty.any()

    row = screener_row(
        "v",
        _classes(),
        np.full(SHAPE, 1.0),
        np.full(SHAPE, 2.0),
        empty,
    )
    assert row["n_cells_evaluated"] == 0
    assert row["valid_area_fraction"] is None
    assert row["regional_contrast"] is None
    assert row["median_sen_slope_decade_sig"] is None


def test_domain_mask_crosses_antimeridian() -> None:
    common = np.zeros(SHAPE, dtype=bool)
    common[80:100, 0:5] = True
    common[80:100, 355:360] = True

    across = domain_mask((170.0, -10.0, -170.0, 10.0), common)
    assert int(across.sum()) == 200  # 20 rows x (5 east + 5 west) columns


def test_domain_mask_rejects_bad_inputs() -> None:
    common = np.zeros(SHAPE, dtype=bool)
    with pytest.raises(ValueError):
        domain_mask("europe", common)
    with pytest.raises(ValueError):
        domain_mask((0.0, 20.0, 10.0, 10.0), common)  # south > north
    with pytest.raises(ValueError):
        domain_mask("global", np.zeros((2, 2), dtype=bool))


def _brute_force_weighted_median(values, weights) -> float:
    """Expand integer weights and apply the contract's >=50% rank rule."""

    expanded = np.repeat(np.asarray(values, dtype=float), np.asarray(weights, dtype=int))
    ordered = np.sort(expanded)
    rank = int(np.ceil(0.5 * ordered.size)) - 1
    return float(ordered[rank])


@pytest.mark.parametrize(
    ("values", "weights"),
    [
        ([10.0, 20.0, 30.0], [1, 2, 1]),
        ([1.0, 2.0, 3.0, 4.0], [1, 1, 1, 1]),
        ([5.0, 9.0], [2, 1]),
        ([1.0, 2.0, 3.0], [1, 1, 2]),  # exact 50% tie -> lower value
        ([7.0], [3]),
    ],
)
def test_weighted_median_against_expanded_sample(values, weights) -> None:
    assert weighted_median(values, weights) == pytest.approx(
        _brute_force_weighted_median(values, weights)
    )


def test_weighted_median_handles_unusable_weights_and_values() -> None:
    assert weighted_median([], []) is None
    assert weighted_median([1.0, 2.0], [0.0, 0.0]) is None
    assert weighted_median([np.nan, 2.0], [1.0, 1.0]) == pytest.approx(2.0)
    assert weighted_median([1.0, 2.0], [1.0, np.inf]) == pytest.approx(1.0)
    with pytest.raises(ValueError):
        weighted_median([1.0, 2.0], [1.0])


def test_rows_have_exact_contract_keys_and_json_types() -> None:
    trend_class = _classes()
    trend_class[90, :10] = contract.TREND_INCREASE
    trend_class[90, 10:20] = contract.TREND_DECREASE

    row = screener_row(
        "root_zone_soil_moisture",
        trend_class,
        np.full(SHAPE, 0.4),
        np.full(SHAPE, -3.2),
        _domain(),
    )

    assert set(row) == ROW_KEYS
    assert isinstance(row["variable"], str)
    for key in ROW_KEYS - {"variable"}:
        assert row[key] is None or type(row[key]) in (int, float)
    assert type(row["n_cells_evaluated"]) is int
    json.dumps(row)  # raises if any NumPy scalar leaked through


def test_screener_table_preserves_order_and_validates_layers() -> None:
    domain = _domain()
    layers = {
        "trend_class": _classes(),
        "std_change_decade": np.full(SHAPE, 0.1),
        "sen_slope_decade": np.full(SHAPE, 0.2),
    }
    rows = screener_table({"b": layers, "a": dict(layers)}, domain)

    assert [row["variable"] for row in rows] == ["b", "a"]
    assert all(set(row) == ROW_KEYS for row in rows)

    with pytest.raises(KeyError):
        screener_table({"missing_layer": {"trend_class": _classes()}}, domain)
