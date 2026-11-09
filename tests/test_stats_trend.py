"""P03 tests: single-series trend behaviour (spec section 5, cases 1, 2, 3, 4, 5, 6, 7).

Synthetic only, fixed seeds. Case numbering follows docs/packages/specs/P03_statistical_engine.md.
"""

from __future__ import annotations

import numpy as np
import pytest

from earthpulse.contract import (
    INSUFFICIENT_DATA,
    TREND_DECREASE,
    TREND_INCREASE,
    TREND_NOT_SIGNIFICANT,
)
from earthpulse.stats.trend import analyse_series, sen_slope_real_time, trend_grid

N = 288  # full-window month count (2001-01 .. 2024-12)
T_YEARS = np.arange(N, dtype=float) / 12.0


def one_cell_grid(series: np.ndarray, inside: bool = True) -> tuple[np.ndarray, np.ndarray]:
    """(288, 1, 1) cube + (1, 1) mask holding one cell."""
    cube = np.asarray(series, dtype=float).reshape(-1, 1, 1)
    return cube, np.array([[inside]])


def series_trend_class(series: np.ndarray) -> tuple[int, dict]:
    cube, mask = one_cell_grid(series)
    layers, extras = trend_grid(cube, mask, T_YEARS)
    return int(layers["trend_class"][0, 0]), {**extras, **layers}


def test_case1_linear_increase_class_and_slope():
    """Linear increase + noise -> class increase, Sen slope within 5% of truth."""
    rng = np.random.default_rng(101)
    truth = 0.03  # per year
    x = truth * T_YEARS + rng.normal(0.0, 0.02, size=N)
    cls, res = series_trend_class(x)
    assert cls == TREND_INCREASE
    assert res["sen_slope"][0, 0] == pytest.approx(truth, rel=0.05)
    # standardized change is finite and positive
    assert np.isfinite(res["std_change_decade"][0, 0])
    assert res["std_change_decade"][0, 0] > 0


def test_case2_linear_decrease():
    rng = np.random.default_rng(202)
    x = -0.03 * T_YEARS + rng.normal(0.0, 0.02, size=N)
    cls, _ = series_trend_class(x)
    assert cls == TREND_DECREASE


def test_case3_white_noise_not_significant_in_90pct_of_200_seeds():
    """White noise, no trend: not significant (single-series p, q == p) in >= 90% of seeds.

    Uses the unmodified Mann-Kendall p (the classic test; white noise has no
    serial correlation to correct). The Hamed-Rao modified test is notably
    liberal on white noise (~10% false positives over these seeds) - measured
    and reported in docs/packages/reports/P03_REPORT.md.
    """
    n_not_significant = 0
    for seed in range(200):
        rng = np.random.default_rng(seed)
        res = analyse_series(rng.normal(0.0, 1.0, size=N))
        assert res["evaluated"]
        if res["p_value_original"] >= 0.05:
            n_not_significant += 1
    assert n_not_significant >= 180  # 90% of 200


def test_case4_seasonal_cycle_not_significant_after_anomaly_removal():
    """Strong seasonal cycle, no trend: anomalies (climatology removed) are not significant."""
    rng = np.random.default_rng(304)
    months = np.arange(N) % 12
    seasonal = 10.0 * np.sin(2 * np.pi * months / 12.0)
    raw = seasonal + rng.normal(0.0, 0.1, size=N)
    # baseline climatology per calendar month over 2001-2020 (240 months)
    clim = np.array([raw[(months == m) & (np.arange(N) < 240)].mean() for m in range(12)])
    anomaly = raw - clim[months]
    res = analyse_series(anomaly)
    assert res["evaluated"]
    assert res["p_value"] >= 0.05
    assert abs(res["sen_slope"]) < 0.005  # per year; raw seasonal amplitude is 10


def test_case5_ar1_modified_test_rejects_less_than_original():
    """AR(1) phi=0.6, no trend: modified test false-positive rate < original's."""
    phi = 0.6
    rej_mod = rej_org = 0
    for seed in range(200):
        rng = np.random.default_rng(seed)
        eps = rng.normal(0.0, 1.0, size=N)
        x = np.empty(N)
        x[0] = eps[0] / np.sqrt(1 - phi**2)
        for k in range(1, N):
            x[k] = phi * x[k - 1] + eps[k]
        res = analyse_series(x)
        rej_mod += res["p_value"] < 0.05
        rej_org += res["p_value_original"] < 0.05
    print(
        f"\n[case5] AR(1) phi=0.6 false-positive rates over 200 seeds: "
        f"modified={rej_mod / 200:.3f}, original={rej_org / 200:.3f}"
    )
    assert rej_mod < rej_org


def test_case6_missing_months_direction_and_insufficient():
    """10% missing -> still correct direction; 30% missing -> INSUFFICIENT_DATA."""
    rng = np.random.default_rng(606)
    truth = 0.03
    clean = truth * T_YEARS + rng.normal(0.0, 0.02, size=N)

    drop10 = rng.random(N) < 0.10
    x10 = clean.copy()
    x10[drop10] = np.nan
    cls, _ = series_trend_class(x10)
    assert cls == TREND_INCREASE

    drop30 = rng.random(N) < 0.30
    x30 = clean.copy()
    x30[drop30] = np.nan
    cls, res = series_trend_class(x30)
    assert cls == INSUFFICIENT_DATA
    assert res["n_valid"][0, 0] == int((~drop30).sum())
    # NaN layers except n_valid / coverage (spec section 3.1)
    assert np.isnan(res["sen_slope"][0, 0])
    assert np.isnan(res["p_value"][0, 0])
    assert res["coverage"][0, 0] == pytest.approx((~drop30).mean())


def test_case7_single_outlier_does_not_flip_sen_slope_sign():
    rng = np.random.default_rng(707)
    x = 0.03 * T_YEARS + rng.normal(0.0, 0.05, size=N)
    x[100] += 1000.0
    res = analyse_series(x)
    assert res["sen_slope"] > 0


def test_sen_slope_real_time_positions_handle_gaps():
    """Slopes use real time positions: a gap changes the pairwise denominators."""
    t = np.array([0.0, 1.0, 2.0, 4.0])  # years, one missing year
    x = 2.0 * t  # slope 2 everywhere
    assert sen_slope_real_time(x, t) == pytest.approx(2.0)
    # the naive evenly spaced variant mis-scales the slopes (median pairwise = 28)
    from earthpulse.stats.trend import sen_slope_evenly_spaced

    assert sen_slope_evenly_spaced(x) == pytest.approx(28.0)


def test_constant_series_is_not_significant_not_nan():
    """Degenerate constant series: slope 0, p = 1 (no trend evidence), class 0."""
    cls, res = series_trend_class(np.full(N, 5.0))
    assert res["coverage"][0, 0] == 1.0
    assert res["sen_slope"][0, 0] == 0.0
    assert res["p_value"][0, 0] == pytest.approx(1.0)
    assert cls == TREND_NOT_SIGNIFICANT


def test_stats_reference_fixture_round_trips():
    """stats_reference.json: recomputed values match the stored references."""
    import json
    from pathlib import Path

    fixture = Path(__file__).resolve().parents[0] / "fixtures" / "stats_reference.json"
    data = json.loads(fixture.read_text(encoding="utf-8"))
    assert data["synthetic"] is True
    assert len(data["series"]) == 5
    for entry in data["series"]:
        values = np.asarray(entry["values"], dtype=float)
        assert values.size == entry["n"]
        res = analyse_series(values)
        assert res["sen_slope"] == pytest.approx(entry["sen_slope_per_year"], rel=1e-9, abs=1e-12)
        assert res["p_value_original"] == pytest.approx(entry["p_value_original"], rel=1e-9, abs=1e-12)
        assert res["mk_tau_original"] == pytest.approx(entry["mk_tau"], rel=1e-9, abs=1e-12)
