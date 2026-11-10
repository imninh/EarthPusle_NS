"""Spatial multiple-testing control for EarthPulse (P03).

Benjamini-Hochberg FDR applied to the Mann-Kendall p-values of all *evaluated*
grid cells of one variable x window (plan section 5.5, DATA_CONTRACT section 7).
"""

from __future__ import annotations

import numpy as np
from statsmodels.stats.multitest import multipletests

from earthpulse.contract import Q_THRESHOLD


def bh_fdr(p_values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Benjamini-Hochberg adjusted q-values.

    Parameters
    ----------
    p_values:
        Array of raw p-values. Non-finite entries (not evaluated) are excluded
        from the family and get NaN back; they must not be part of the family
        (spec: FDR runs over the evaluated cells only).

    Returns
    -------
    (q_values, rejected)
        ``q_values`` has the same shape as ``p_values`` (NaN where excluded);
        ``rejected`` is a boolean array (False where excluded) that follows the
        contract strictly: ``q < Q_THRESHOLD``. ``multipletests`` itself can
        reject at ``q == Q_THRESHOLD``, so its mask is not used directly.
    """
    p = np.asarray(p_values, dtype=float)
    q = np.full(p.shape, np.nan)
    rejected = np.zeros(p.shape, dtype=bool)

    finite = np.isfinite(p)
    n = int(finite.sum())
    if n == 0:
        return q, rejected

    # clip to [0, 1] so tiny floating-point overshoots cannot break multipletests
    p_in = np.clip(p[finite], 0.0, 1.0)
    _, q_adj, _, _ = multipletests(p_in, alpha=Q_THRESHOLD, method="fdr_bh")
    q[finite] = q_adj
    rejected[finite] = q_adj < Q_THRESHOLD
    return q, rejected
