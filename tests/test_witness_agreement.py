"""Synthetic tests for schema-1.3 witness agreement layers (DATA_CONTRACT §13)."""

from __future__ import annotations

import numpy as np

from earthpulse import contract
from earthpulse.witness_agreement import (
    witness_agreement,
    witness_layers,
    witness_screener_fields,
    witness_std_change,
)

SHAPE = (contract.N_ROWS, contract.N_COLS)


def _blank(value: float) -> np.ndarray:
    return np.full(SHAPE, value, dtype=float)


def _base() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    main_slope = _blank(np.nan)
    main_q = _blank(np.nan)
    main_class = np.full(SHAPE, contract.INSUFFICIENT_DATA, dtype=np.int8)
    witness_slope = _blank(np.nan)
    witness_q = _blank(np.nan)
    witness_class = np.full(SHAPE, contract.INSUFFICIENT_DATA, dtype=np.int8)
    mask = np.zeros(SHAPE, dtype=bool)
    return main_slope, main_q, main_class, witness_slope, witness_q, witness_class, mask


def _set(
    arrays: tuple[np.ndarray, ...],
    row: int,
    col: int,
    main: tuple[float, float, int],
    witness: tuple[float, float, int],
) -> None:
    main_slope, main_q, main_class, witness_slope, witness_q, witness_class, mask = arrays
    mask[row, col] = True
    main_slope[row, col], main_q[row, col], main_class[row, col] = main
    witness_slope[row, col], witness_q[row, col], witness_class[row, col] = witness


def test_every_agreement_code_and_std_change() -> None:
    arrays = _base()
    # code 2: both significant, same sign
    _set(arrays, 45, 10, (1.0, 0.001, contract.TREND_INCREASE), (2.0, 0.001, contract.TREND_INCREASE))
    # code 1: witness not significant, same sign
    _set(arrays, 45, 11, (1.0, 0.001, contract.TREND_INCREASE), (0.5, 0.5, contract.TREND_NOT_SIGNIFICANT))
    # code -1: witness not significant, opposite sign
    _set(arrays, 45, 12, (1.0, 0.001, contract.TREND_INCREASE), (-0.5, 0.5, contract.TREND_NOT_SIGNIFICANT))
    # code -2: both significant, opposite sign
    _set(arrays, 45, 13, (1.0, 0.001, contract.TREND_INCREASE), (-2.0, 0.001, contract.TREND_DECREASE))
    # code 0: main not significant
    _set(arrays, 46, 10, (0.5, 0.5, contract.TREND_NOT_SIGNIFICANT), (1.0, 0.001, contract.TREND_INCREASE))
    # -9: witness not evaluated
    _set(arrays, 46, 11, (1.0, 0.001, contract.TREND_INCREASE), (np.nan, np.nan, contract.INSUFFICIENT_DATA))
    # -9: main not evaluated
    _set(arrays, 46, 12, (np.nan, np.nan, contract.INSUFFICIENT_DATA), (1.0, 0.001, contract.TREND_INCREASE))
    # -99: outside the mask
    _set(arrays, 46, 13, (1.0, 0.001, contract.TREND_INCREASE), (1.0, 0.001, contract.TREND_INCREASE))
    arrays[6][46, 13] = False

    main_slope, main_q, main_class, witness_slope, witness_q, witness_class, mask = arrays
    codes = witness_agreement(
        main_slope, main_q, main_class, witness_slope, witness_q, witness_class, mask=mask
    )
    assert codes[45, 10] == contract.WITNESS_CORROBORATED
    assert codes[45, 11] == contract.WITNESS_SAME_SIGN
    assert codes[45, 12] == contract.WITNESS_OPPOSITE_SIGN
    assert codes[45, 13] == contract.WITNESS_CONTRADICTED
    assert codes[46, 10] == contract.WITNESS_MAIN_NOT_SIGNIFICANT
    assert codes[46, 11] == contract.INSUFFICIENT_DATA
    assert codes[46, 12] == contract.INSUFFICIENT_DATA
    assert codes[46, 13] == contract.OUTSIDE_DOMAIN
    assert codes[0, 0] == contract.OUTSIDE_DOMAIN

    std = witness_std_change(np.full(SHAPE, 1.5), codes)
    assert np.isnan(std[46, 11])
    assert np.isnan(std[46, 13])
    assert std[45, 10] == np.float32(1.5)


def test_q_threshold_and_zero_slope_are_handled() -> None:
    arrays = _base()
    # q exactly at the threshold is not significant.
    _set(arrays, 45, 10, (1.0, contract.Q_THRESHOLD, contract.TREND_NOT_SIGNIFICANT), (1.0, 0.001, contract.TREND_INCREASE))
    # A zero main slope is evaluated but not significant.
    _set(arrays, 45, 11, (0.0, 0.001, contract.TREND_NOT_SIGNIFICANT), (1.0, 0.001, contract.TREND_INCREASE))
    # Main significant, witness zero slope: no direction, so not evaluated.
    _set(arrays, 45, 12, (1.0, 0.001, contract.TREND_INCREASE), (0.0, 0.001, contract.TREND_INCREASE))

    main_slope, main_q, main_class, witness_slope, witness_q, witness_class, mask = arrays
    codes = witness_agreement(
        main_slope, main_q, main_class, witness_slope, witness_q, witness_class, mask=mask
    )
    assert codes[45, 10] == contract.WITNESS_MAIN_NOT_SIGNIFICANT
    assert codes[45, 11] == contract.WITNESS_MAIN_NOT_SIGNIFICANT
    assert codes[45, 12] == contract.INSUFFICIENT_DATA


def test_witness_layers_returns_both_layers() -> None:
    arrays = _base()
    _set(arrays, 45, 10, (1.0, 0.001, contract.TREND_INCREASE), (2.0, 0.001, contract.TREND_INCREASE))
    main_slope, main_q, main_class, witness_slope, witness_q, witness_class, mask = arrays
    main = {
        "sen_slope": main_slope,
        "q_value": main_q,
        "trend_class": main_class,
    }
    witness = {
        "sen_slope": witness_slope,
        "q_value": witness_q,
        "trend_class": witness_class,
        "std_change_decade": np.full(SHAPE, 0.75),
    }
    layers = witness_layers(main, witness, mask)
    assert set(layers) == {"witness_agreement", "witness_std_change"}
    assert layers["witness_agreement"][45, 10] == contract.WITNESS_CORROBORATED
    assert layers["witness_std_change"][45, 10] == np.float32(0.75)
    assert np.isnan(layers["witness_std_change"][0, 0])


def test_screener_fractions_on_hand_checked_four_cells() -> None:
    trend_class = np.full(SHAPE, contract.OUTSIDE_DOMAIN, dtype=np.int8)
    agreement = np.full(SHAPE, contract.OUTSIDE_DOMAIN, dtype=np.int8)
    domain = np.zeros(SHAPE, dtype=bool)
    # Same latitude row: all four cell weights are equal.
    domain[45, 10:14] = True
    trend_class[45, 10] = contract.TREND_INCREASE
    trend_class[45, 11] = contract.TREND_DECREASE
    trend_class[45, 12] = contract.TREND_NOT_SIGNIFICANT
    trend_class[45, 13] = contract.INSUFFICIENT_DATA
    agreement[45, 10] = contract.WITNESS_CORROBORATED
    agreement[45, 11] = contract.WITNESS_CONTRADICTED
    agreement[45, 12] = contract.WITNESS_MAIN_NOT_SIGNIFICANT
    agreement[45, 13] = contract.INSUFFICIENT_DATA

    fields = witness_screener_fields(trend_class, agreement, domain)
    assert fields["witness_corroborated_fraction"] == 0.5
    assert fields["witness_contradicted_fraction"] == 0.5

    empty = witness_screener_fields(
        np.full(SHAPE, contract.TREND_NOT_SIGNIFICANT, dtype=np.int8),
        np.full(SHAPE, contract.WITNESS_MAIN_NOT_SIGNIFICANT, dtype=np.int8),
        domain,
    )
    assert empty["witness_corroborated_fraction"] is None
    assert empty["witness_contradicted_fraction"] is None
