"""Per-cell inter-variable association for EarthPulse (P03).

Spearman rank correlation between the monthly *anomalies* of two variables
(plan section 5.6, DATA_CONTRACT section 7): raw, and again after removing
each series' own Sen line within the window (``r_detrended``) to separate
co-variation from a correlation driven by shared long-term trends.

``r_detrended`` is only computed where both series have a fitted Sen line
(i.e. both trend analyses succeeded for that cell and window); otherwise it
is NaN. This choice is documented in docs/packages/reports/P03_REPORT.md.
"""

from __future__ import annotations

import numpy as np
from scipy.stats import spearmanr

from earthpulse.contract import CORRELATION_LAYERS
from earthpulse.stats.fdr import bh_fdr

# Below this many paired valid months a rank correlation is not meaningful.
# Real cells must pass the >= 80% paired-coverage rule first.
MIN_PAIRS = 4


def spearman_nan_safe(x: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """Spearman rho and p on paired NaN-free samples; NaN for degenerate input."""
    if x.size < 3 or np.ptp(x) == 0 or np.ptp(y) == 0:
        return np.nan, np.nan
    res = spearmanr(x, y)
    return float(res.statistic), float(res.pvalue)


def correlation_grid(
    a: np.ndarray,
    b: np.ndarray,
    mask: np.ndarray,
    t_years: np.ndarray | None = None,
    sen_a: dict[str, np.ndarray] | None = None,
    sen_b: dict[str, np.ndarray] | None = None,
) -> dict[str, np.ndarray]:
    """Grid driver for one variable pair x window.

    Parameters
    ----------
    a, b:
        ``(n_time, n_lat, n_lon)`` monthly anomaly arrays (NaN = missing).
    mask:
        ``(n_lat, n_lon)`` bool, True = inside the common domain mask.
    t_years:
        ``(n_time,)`` time positions in years from the window start.
    sen_a, sen_b:
        Optional dicts with ``"sen_slope"`` and ``"sen_intercept"``
        ``(n_lat, n_lon)`` arrays from the trend step of each variable
        (see :func:`earthpulse.stats.trend.trend_grid` extras/layers). When
        both are given, the detrended correlation layers are filled.

    Returns
    -------
    dict
        One ``(n_lat, n_lon)`` array per name in ``contract.CORRELATION_LAYERS``
        (``n_pairs`` as float32 per the contract), BH-FDR-adjusted per map over
        the evaluated cells.
    """
    aa = np.asarray(a, dtype=float)
    bb = np.asarray(b, dtype=float)
    m = np.asarray(mask, dtype=bool)
    n_time, n_lat, n_lon = aa.shape
    if t_years is None:
        t_years = np.arange(n_time, dtype=float) / 12.0
    t_years = np.asarray(t_years, dtype=float)

    detrend = sen_a is not None and sen_b is not None

    layers: dict[str, np.ndarray] = {
        name: np.full((n_lat, n_lon), np.nan) for name in CORRELATION_LAYERS
    }

    evaluated_rows: list[int] = []
    evaluated_cols: list[int] = []
    p_raw_list: list[float] = []
    p_det_rows: list[int] = []
    p_det_cols: list[int] = []
    p_det_list: list[float] = []

    rows, cols = np.nonzero(m)
    for r, c in zip(rows, cols):
        xa, xb = aa[:, r, c], bb[:, r, c]
        paired = np.isfinite(xa) & np.isfinite(xb)
        n_pairs = int(paired.sum())
        layers["n_pairs"][r, c] = n_pairs
        if n_pairs < max(MIN_PAIRS, int(np.ceil(0.8 * n_time))):
            continue

        r_raw, p_raw = spearman_nan_safe(xa[paired], xb[paired])
        if not np.isfinite(r_raw):
            continue
        layers["r"][r, c] = r_raw
        evaluated_rows.append(r)
        evaluated_cols.append(c)
        p_raw_list.append(p_raw)

        if not detrend:
            continue
        slope_a, inter_a = sen_a["sen_slope"][r, c], sen_a["sen_intercept"][r, c]
        slope_b, inter_b = sen_b["sen_slope"][r, c], sen_b["sen_intercept"][r, c]
        if not (
            np.isfinite(slope_a)
            and np.isfinite(inter_a)
            and np.isfinite(slope_b)
            and np.isfinite(inter_b)
        ):
            continue
        # Remove each series' own Sen line over the window, then correlate the
        # residuals on the same paired months.
        ra = xa[paired] - (inter_a + slope_a * t_years[paired])
        rb = xb[paired] - (inter_b + slope_b * t_years[paired])
        r_det, p_det = spearman_nan_safe(ra, rb)
        if not np.isfinite(r_det):
            continue
        layers["r_detrended"][r, c] = r_det
        p_det_rows.append(r)
        p_det_cols.append(c)
        p_det_list.append(p_det)

    if p_raw_list:
        rr = np.asarray(evaluated_rows)
        cc = np.asarray(evaluated_cols)
        p_map = np.full((n_lat, n_lon), np.nan)
        p_map[rr, cc] = p_raw_list
        layers["q"], _ = bh_fdr(p_map)
    else:  # empty family: q stays all-NaN
        layers["q"] = np.full((n_lat, n_lon), np.nan)

    if p_det_list:
        rr = np.asarray(p_det_rows)
        cc = np.asarray(p_det_cols)
        p_map = np.full((n_lat, n_lon), np.nan)
        p_map[rr, cc] = p_det_list
        layers["q_detrended"], _ = bh_fdr(p_map)
    else:
        layers["q_detrended"] = np.full((n_lat, n_lon), np.nan)

    layers["n_pairs"] = layers["n_pairs"].astype(np.float32)
    assert set(layers) == set(CORRELATION_LAYERS)
    return layers
