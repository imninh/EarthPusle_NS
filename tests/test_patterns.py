"""Tests for the P03b pattern classes.

Synthetic arrays only. Covers the full 5 x 5 truth table of contract codes and
the missing-data precedence rule (-99 wins over -9).
"""

from __future__ import annotations

import numpy as np
import pytest

from earthpulse import contract
from earthpulse.patterns import pattern_class

CODES = (
    contract.TREND_INCREASE,
    contract.TREND_DECREASE,
    contract.TREND_NOT_SIGNIFICANT,
    contract.INSUFFICIENT_DATA,
    contract.OUTSIDE_DOMAIN,
)


def _expected(temp: int, moist: int) -> int:
    if temp == contract.OUTSIDE_DOMAIN or moist == contract.OUTSIDE_DOMAIN:
        return contract.OUTSIDE_DOMAIN
    if temp == contract.INSUFFICIENT_DATA or moist == contract.INSUFFICIENT_DATA:
        return contract.INSUFFICIENT_DATA
    if temp == contract.TREND_INCREASE:
        if moist == contract.TREND_DECREASE:
            return contract.PATTERN_WARMING_DRYING
        if moist == contract.TREND_INCREASE:
            return contract.PATTERN_WARMING_WETTING
    if temp == contract.TREND_DECREASE:
        if moist == contract.TREND_DECREASE:
            return contract.PATTERN_COOLING_DRYING
        if moist == contract.TREND_INCREASE:
            return contract.PATTERN_COOLING_WETTING
    return contract.PATTERN_MIXED


def test_pattern_truth_table_covers_all_25_combinations() -> None:
    temperature, moisture = np.meshgrid(CODES, CODES, indexing="ij")
    result = pattern_class(
        temperature.astype(np.int8), moisture.astype(np.int8)
    )

    assert result.shape == temperature.shape
    assert result.dtype == np.int8
    for i, temp in enumerate(CODES):
        for j, moist in enumerate(CODES):
            assert result[i, j] == _expected(temp, moist), (temp, moist)


def test_pattern_specific_semantics() -> None:
    temperature = np.array(
        [1, 1, -1, -1, 0, 0, 1, -1], dtype=np.int8
    )
    moisture = np.array(
        [-1, 1, -1, 1, -1, 1, 0, 0], dtype=np.int8
    )
    result = pattern_class(temperature, moisture)

    assert result.tolist() == [1, 2, 3, 4, 0, 0, 0, 0]


def test_missing_codes_take_precedence_and_minus_99_wins() -> None:
    temperature = np.array(
        [-99, -9, 1, -99, -9, 0], dtype=np.int8
    )
    moisture = np.array(
        [-9, -99, -9, -99, 1, -99], dtype=np.int8
    )
    result = pattern_class(temperature, moisture)

    assert result.tolist() == [-99, -99, -9, -99, -9, -99]


def test_invalid_codes_raise() -> None:
    with pytest.raises(ValueError):
        pattern_class(
            np.array([[2]], dtype=np.int8), np.array([[0]], dtype=np.int8)
        )
    with pytest.raises(ValueError):
        pattern_class(
            np.array([[1.5]], dtype=np.float64),
            np.array([[0.0]], dtype=np.float64),
        )
    with pytest.raises(ValueError):
        pattern_class(
            np.array([[np.nan]]), np.array([[1.0]])
        )


def test_shape_mismatch_raises() -> None:
    with pytest.raises(ValueError):
        pattern_class(
            np.zeros((2, 3), dtype=np.int8),
            np.zeros((3, 2), dtype=np.int8),
        )


def test_result_is_a_new_contract_shaped_array() -> None:
    temperature = np.zeros(
        (contract.N_ROWS, contract.N_COLS), dtype=np.int8
    )
    moisture = np.zeros_like(temperature)
    temperature[23, 192] = contract.TREND_INCREASE  # central Sahara index
    moisture[23, 192] = contract.TREND_DECREASE

    result = pattern_class(temperature, moisture)

    assert result.shape == (contract.N_ROWS, contract.N_COLS)
    assert result.dtype == np.int8
    assert result[23, 192] == contract.PATTERN_WARMING_DRYING
    assert not np.shares_memory(result, temperature)
    assert not np.shares_memory(result, moisture)
