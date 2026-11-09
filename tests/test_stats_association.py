"""P03 tests: per-cell Spearman association (spec section 5, case 9 + extras)."""

from __future__ import annotations

import numpy as np
import pytest

from earthpulse.stats.association import correlation_grid, spearman_nan_safe
from earthpulse.stats.trend import trend_grid

N = 288
T_YEARS = np.arange(N, dtype=float) / 12.0


def one_cell_layers(x: np.ndarray) -> tuple[dict, dict]:
    """Trend grids for a single inside-mask cell holding series x."""
    cube = x.reshape(-1, 1, 1)
    mask = np.array([[True]])
    return trend_grid(cube, mask, T_YEARS)


def one_cell_correlation(x: np.ndarray, y: np.ndarray) -> dict:
    layers_a, extras_a = one_cell_layers(x)
    layers_b, extras_b = one_cell_layers(y)
    sen_a = {"sen_slope": layers_a["sen_slope"], "sen_intercept": extras_a["sen_intercept"]}
    sen_b = {"sen_slope": layers_b["sen_slope"], "sen_intercept": extras_b["sen_intercept"]}
    return correlation_grid(
        x.reshape(-1, 1, 1),
        y.reshape(-1, 1, 1),
        np.array([[True]]),
        T_YEARS,
        sen_a=sen_a,
        sen_b=sen_b,
    )


def test_case9_perfectly_monotonic_pair_rho_one():
    x = np.linspace(0, 1, N)
    y = np.exp(3 * x)  # strictly monotonic, nonlinear
    r, _ = spearman_nan_safe(x, y)
    assert r == pytest.approx(1.0, abs=1e-12)


def test_case9_independent_trending_series_raw_high_detrended_near_zero():
    """Two independent trending series: raw rho high, detrended rho near 0."""
    rng = np.random.default_rng(909)
    t = T_YEARS
    x = 0.05 * t + rng.normal(0.0, 0.1, size=N)
    y = 0.04 * t + rng.normal(0.0, 0.1, size=N)
    layers = one_cell_correlation(x, y)
    r_raw = float(layers["r"][0, 0])
    r_det = float(layers["r_detrended"][0, 0])
    assert r_raw > 0.8
    assert abs(r_det) < 0.2
    # strongly co-trending pair: raw correlation is significant after BH
    assert layers["q"][0, 0] < 0.05
    assert np.isfinite(layers["q_detrended"][0, 0])


def test_n_pairs_counts_paired_valid_months_only():
    rng = np.random.default_rng(910)
    x = rng.normal(0.0, 1.0, size=N)
    y = rng.normal(0.0, 1.0, size=N)
    x[50:60] = np.nan
    y[55:75] = np.nan  # union of invalid months [50, 75) = 25 months
    layers = one_cell_correlation(x, y)
    assert layers["n_pairs"][0, 0] == N - 25


def test_low_paired_coverage_not_evaluated():
    rng = np.random.default_rng(911)
    x = rng.normal(0.0, 1.0, size=N)
    y = rng.normal(0.0, 1.0, size=N)
    x[240:] = np.nan  # 83% paired -> still evaluated
    y2 = y.copy()
    y2[200:] = np.nan  # 69% paired -> below 80% rule
    layers_low = one_cell_correlation(x, y2)
    assert np.isnan(layers_low["r"][0, 0])
    layers_ok = one_cell_correlation(x, y)
    assert np.isfinite(layers_ok["r"][0, 0])
    assert layers_ok["n_pairs"][0, 0] == 240


def test_constant_series_correlation_is_nan():
    layers = one_cell_correlation(np.full(N, 1.0), np.arange(N, dtype=float))
    assert np.isnan(layers["r"][0, 0])
    assert np.isnan(layers["q"][0, 0])


def test_detrended_requires_both_sen_lines():
    rng = np.random.default_rng(912)
    x = 0.05 * np.arange(N) / 12.0 + rng.normal(0.0, 0.1, size=N)
    y = 0.04 * np.arange(N) / 12.0 + rng.normal(0.0, 0.1, size=N)
    layers_a, extras_a = one_cell_layers(x)
    layers_b, extras_b = one_cell_layers(y)
    # b has no fitted Sen line (NaN slope) -> r_detrended stays NaN
    sen_b = {
        "sen_slope": np.full((1, 1), np.nan),
        "sen_intercept": np.full((1, 1), np.nan),
    }
    sen_a = {"sen_slope": layers_a["sen_slope"], "sen_intercept": extras_a["sen_intercept"]}
    layers = correlation_grid(
        x.reshape(-1, 1, 1), y.reshape(-1, 1, 1), np.array([[True]]), T_YEARS,
        sen_a=sen_a, sen_b=sen_b,
    )
    assert np.isnan(layers["r_detrended"][0, 0])
    assert np.isfinite(layers["r"][0, 0])


def test_fdr_per_map_and_n_pairs_dtype():
    """A multi-cell map: q filled for evaluated cells only; n_pairs float32."""
    rng = np.random.default_rng(913)
    n_time = 120
    t = np.arange(n_time, dtype=float) / 12.0
    mask = np.zeros((2, 3), dtype=bool)
    mask[:, 0:2] = True  # 4 inside cells
    base = 0.05 * t[:, None, None] + rng.normal(0.0, 0.2, size=(n_time, 2, 2))
    a = np.full((n_time, 2, 3), np.nan)
    b = np.full((n_time, 2, 3), np.nan)
    a[:, 0:2, 0:2] = base
    b[:, 0:2, 0:2] = base + rng.normal(0.0, 0.1, size=(n_time, 2, 2))

    from earthpulse.stats.trend import trend_grid as tg

    sen_a = {"sen_slope": np.full((2, 3), np.nan), "sen_intercept": np.full((2, 3), np.nan)}
    sen_b = dict(sen_a)
    la, ea = tg(a, mask, t)
    lb, eb = tg(b, mask, t)
    sen_a["sen_slope"], sen_a["sen_intercept"] = la["sen_slope"], ea["sen_intercept"]
    sen_b["sen_slope"], sen_b["sen_intercept"] = lb["sen_slope"], eb["sen_intercept"]
    layers = correlation_grid(a, b, mask, t, sen_a=sen_a, sen_b=sen_b)
    assert layers["n_pairs"].dtype == np.float32
    assert np.isfinite(layers["r"][:, 0:2][mask[:, 0:2]]).all()
    assert np.isnan(layers["r"][:, 2]).all()
    # strongly co-moving series -> high rho everywhere evaluated, q significant
    assert (layers["r"][:, 0:2] > 0.9).all()
    assert np.isfinite(layers["q"][:, 0:2][mask[:, 0:2]]).all()
