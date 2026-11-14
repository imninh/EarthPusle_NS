"""Unit test for the C2 share function. All grids are synthetic (built here)."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from c2_baseline_compare import compute_shares, lat_weights  # noqa: E402


def test_shares_on_synthetic_grid():  # synthetic
    shape = (180, 360)
    tc = np.full(shape, -99, dtype=np.int8)
    tc[0, :2] = 0  # two evaluated cells in the north row
    tc[90, :2] = 0  # two evaluated cells near the equator
    p_orig = np.full(shape, np.nan, dtype=np.float32)
    p_hr = p_orig.copy()
    q = p_orig.copy()
    p_orig[0, 0] = 0.01  # simple only
    p_orig[90, 0] = 0.01
    p_hr[90, 0] = 0.02
    q[90, 0] = 0.03  # significant under all three
    s = compute_shares(p_orig, p_hr, q, tc)
    w = lat_weights()
    total = 2 * w[0] + 2 * w[90]
    assert abs(s["simple"] - (w[0] + w[90]) / total) < 1e-12
    assert abs(s["autocorr"] - w[90] / total) < 1e-12
    assert abs(s["published"] - w[90] / total) < 1e-12
    assert abs(s["simple_not_published"] - w[0] / total) < 1e-12
