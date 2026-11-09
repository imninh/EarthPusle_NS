"""P03 tests: BH-FDR behaviour (spec section 5, case 8)."""

from __future__ import annotations

import numpy as np
import pytest

from earthpulse.stats.fdr import bh_fdr


def test_bh_fdr_basic_properties():
    p = np.array([0.001, 0.008, 0.039, 0.041, 0.2, 0.5, 0.9])
    q, rej = bh_fdr(p)
    assert np.all(q >= p)
    # smallest p gets p * m / 1
    assert q[0] == pytest.approx(p[0] * len(p))
    # monotone in p among non-NaN
    order = np.argsort(p)
    assert np.all(np.diff(q[order]) >= -1e-12)
    assert rej[0]


def test_bh_fdr_excludes_non_finite():
    p = np.array([np.nan, 0.01, np.nan, 0.9])
    q, rej = bh_fdr(p)
    assert np.isnan(q[0]) and np.isnan(q[2])
    assert q[1] == pytest.approx(0.02)  # 0.01 * 2 (family of 2)
    assert not rej[3]
    assert rej[1]


def test_case8_fdr_keeps_false_discovery_proportion_near_5pct():
    """1000-cell grid, 100 true trends: mean FDP over seeds near/below 5%."""
    n_cells, n_true = 1000, 100
    seeds = range(20)
    fdps = []
    powers = []
    for seed in seeds:
        rng = np.random.default_rng(seed)
        p_null = rng.uniform(0.0, 1.0, size=n_cells - n_true)
        # strong true discoveries: small p-values with spread (like real
        # Mann-Kendall p-values of genuinely trending cells)
        p_true = np.clip(rng.normal(0.001, 0.001, size=n_true), 1e-9, 1.0)
        p = np.concatenate([p_null, p_true])
        _, rej = bh_fdr(p)
        if rej.sum() > 0:
            false_disc = int(rej[: n_cells - n_true].sum())  # nulls are first
            fdp = false_disc / int(rej.sum())
            fdps.append(fdp)
        powers.append(int(rej[n_cells - n_true:].sum()) / n_true)
    mean_fdp = float(np.mean(fdps))
    mean_power = float(np.mean(powers))
    print(
        f"\n[case8] mean FDP over {len(fdps)} seeds: {mean_fdp:.4f} "
        f"(target <= 0.05), mean power: {mean_power:.3f}"
    )
    assert mean_fdp <= 0.05
    assert mean_power >= 0.5  # the correction must not destroy all power


def test_bh_fdr_empty_family():
    q, rej = bh_fdr(np.array([np.nan, np.nan]))
    assert np.isnan(q).all()
    assert not rej.any()
