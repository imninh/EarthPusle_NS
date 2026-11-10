"""Per-cell trend estimation for EarthPulse (P03).

Methods (fixed by docs/packages/specs/P03_statistical_engine.md section 3):

- Sen's slope: median of pairwise slopes (x_j - x_i) / (t_j - t_i) computed at
  the *real* time positions (t in years, month index / 12), so missing months
  (gaps) shift the pairwise slopes correctly. ``pymannkendall.sens_slope`` was
  not used because it assumes the valid points are evenly spaced in time.
- Mann-Kendall: primary p-value from the Hamed-Rao modified test
  (autocorrelation-aware); the unmodified test is kept as a comparison layer.
  When the modified test returns a non-finite p-value for an otherwise
  evaluated cell (degenerate autocorrelation variance), the primary p falls
  back to the unmodified Mann-Kendall p so the cell keeps trend evidence.
  The tests run on the valid points only, in time order (pymannkendall does
  not take explicit time positions); see the P03 report for the measured
  effect of 10% random gaps.
- Standardized change: sen_slope_decade / sd(x - sen_line) with the Sen
  intercept defined as median(x - slope * t).
"""

from __future__ import annotations

import numpy as np
import pymannkendall as mk

from earthpulse.contract import (
    CLASS_LAYERS,
    FLOAT_LAYERS,
    INSUFFICIENT_DATA,
    MIN_VALID_FRACTION,
    MIN_YEARS,
    OUTSIDE_DOMAIN,
    Q_THRESHOLD,
    TREND_DECREASE,
    TREND_INCREASE,
    TREND_NOT_SIGNIFICANT,
)
from earthpulse.stats.fdr import bh_fdr

# Below this many valid points neither Sen's slope (needs >= 2 distinct pairs)
# nor Mann-Kendall is meaningful. Real cells always pass the 80% coverage rule
# first; this is a defensive guard for degenerate inputs.
MIN_POINTS_TREND = 4


def sen_slope_real_time(x: np.ndarray, t_years: np.ndarray) -> float:
    """Median of pairwise slopes at real time positions (both arrays NaN-free)."""
    n = x.size
    i, j = np.triu_indices(n, k=1)
    return float(np.median((x[j] - x[i]) / (t_years[j] - t_years[i])))


def sen_slope_evenly_spaced(x: np.ndarray) -> float:
    """Naive Sen slope treating the valid points as evenly spaced in time.

    Not used by the engine; kept only for the gaps comparison study reported
    in docs/packages/reports/P03_REPORT.md (spec section 3.3).
    """
    return sen_slope_real_time(x, np.arange(x.size, dtype=float) / 12.0)


def analyse_series(x: np.ndarray, t_years: np.ndarray | None = None) -> dict:
    """Single-series trend analysis (monthly values, NaN = missing).

    ``t_years`` are the time positions of ``x`` in years from the window start
    (default: 0, 1/12, 2/12, ...). Returns a dict with the per-cell statistics:

    sen_slope (per year), sen_intercept, sen_slope_decade, std_change_decade,
    p_value (Hamed-Rao), p_value_original, mk_tau, n_valid, evaluated.
    """
    x = np.asarray(x, dtype=float)
    if t_years is None:
        t_years = np.arange(x.size, dtype=float) / 12.0
    t_years = np.asarray(t_years, dtype=float)

    valid = np.isfinite(x)
    n_valid = int(valid.sum())
    out = {
        "sen_slope": np.nan,
        "sen_intercept": np.nan,
        "sen_slope_decade": np.nan,
        "std_change_decade": np.nan,
        "p_value": np.nan,
        "p_value_original": np.nan,
        "mk_tau": np.nan,
        "mk_tau_original": np.nan,
        "n_valid": n_valid,
        "evaluated": False,
    }
    if n_valid < MIN_POINTS_TREND:
        return out

    xv = x[valid]
    tv = t_years[valid]

    if np.ptp(xv) == 0:
        # Degenerate constant series: S = 0 and Var(S) = 0, so the MK tests are
        # undefined (pymannkendall returns NaN); define slope 0, p = 1 (no
        # trend evidence) and no standardized change.
        out.update(
            sen_slope=0.0,
            sen_intercept=float(xv[0]),
            sen_slope_decade=0.0,
            p_value=1.0,
            p_value_original=1.0,
            mk_tau=0.0,
            mk_tau_original=0.0,
            evaluated=True,
        )
        return out

    slope = sen_slope_real_time(xv, tv)
    intercept = float(np.median(xv - slope * tv))
    sen_line = intercept + slope * tv
    residual_sd = float(np.std(xv - sen_line, ddof=1))

    try:
        res_mod = mk.hamed_rao_modification_test(xv)
        res_org = mk.original_test(xv)
        p_mod, tau = float(res_mod.p), float(res_mod.Tau)
        p_org, tau_org = float(res_org.p), float(res_org.Tau)
    except Exception:  # pragma: no cover - degenerate/constant input guard
        p_mod, tau, p_org, tau_org = 1.0, 0.0, 1.0, 0.0

    # Degenerate autocorrelation variance can make the Hamed-Rao p non-finite.
    # For an evaluated cell, fall back to the unmodified MK p (documented in
    # the method notes and P03 report section 3.3).
    if not np.isfinite(p_mod):
        p_mod = p_org
        tau = tau_org

    std_change = (10.0 * slope) / residual_sd if residual_sd > 0 else np.nan

    out.update(
        sen_slope=slope,
        sen_intercept=intercept,
        sen_slope_decade=10.0 * slope,
        std_change_decade=std_change,
        p_value=p_mod,
        p_value_original=p_org,
        mk_tau=tau,
        mk_tau_original=tau_org,
        evaluated=True,
    )
    return out


def trend_grid(
    anomaly: np.ndarray,
    mask: np.ndarray,
    t_years: np.ndarray | None = None,
) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    """Grid driver: per-cell trend statistics for one variable x window.

    Parameters
    ----------
    anomaly:
        ``(n_time, n_lat, n_lon)`` float array of monthly anomalies for the
        window (NaN = missing).
    mask:
        ``(n_lat, n_lon)`` bool, True = inside the common domain mask.
    t_years:
        Optional ``(n_time,)`` time positions in years from the window start.

    Returns
    -------
    (layers, extras)
        ``layers`` holds one ``(n_lat, n_lon)`` array per name in
        ``contract.FLOAT_LAYERS`` + ``contract.CLASS_LAYERS`` (``trend_class``
        as int8). ``extras`` holds internal arrays needed by the association
        step (``sen_intercept``) and the raw per-cell p-values; they are not
        part of the contract layers.
    """
    a = np.asarray(anomaly, dtype=float)
    m = np.asarray(mask, dtype=bool)
    n_time, n_lat, n_lon = a.shape
    if t_years is None:
        t_years = np.arange(n_time, dtype=float) / 12.0
    t_years = np.asarray(t_years, dtype=float)
    window_years = float(n_time) / 12.0

    layers: dict[str, np.ndarray] = {
        name: np.full((n_lat, n_lon), np.nan) for name in FLOAT_LAYERS
    }
    trend_class = np.full((n_lat, n_lon), OUTSIDE_DOMAIN, dtype=np.int8)
    extras: dict[str, np.ndarray] = {
        "sen_intercept": np.full((n_lat, n_lon), np.nan),
        "p_value": layers["p_value"],  # alias, filled below
    }

    evaluated_rows: list[np.ndarray] = []
    evaluated_cols: list[np.ndarray] = []
    p_list: list[float] = []

    rows, cols = np.nonzero(m)
    for r, c in zip(rows, cols):
        series = a[:, r, c]
        n_valid = int(np.isfinite(series).sum())
        coverage = n_valid / n_time
        layers["n_valid"][r, c] = n_valid
        layers["coverage"][r, c] = coverage

        eligible = window_years >= MIN_YEARS and coverage >= MIN_VALID_FRACTION
        if not eligible:
            trend_class[r, c] = INSUFFICIENT_DATA
            continue

        res = analyse_series(series, t_years)
        if not res["evaluated"]:
            trend_class[r, c] = INSUFFICIENT_DATA
            continue

        layers["sen_slope"][r, c] = res["sen_slope"]
        layers["sen_slope_decade"][r, c] = res["sen_slope_decade"]
        layers["std_change_decade"][r, c] = res["std_change_decade"]
        layers["p_value"][r, c] = res["p_value"]
        layers["p_value_original"][r, c] = res["p_value_original"]
        layers["mk_tau"][r, c] = res["mk_tau"]
        extras["sen_intercept"][r, c] = res["sen_intercept"]
        evaluated_rows.append(r)
        evaluated_cols.append(c)
        p_list.append(res["p_value"])

    # Spatial FDR over the evaluated cells of this variable x window only.
    if p_list:
        rr = np.asarray(evaluated_rows)
        cc = np.asarray(evaluated_cols)
        p_map = np.full((n_lat, n_lon), np.nan)
        p_map[rr, cc] = p_list
        q_map, _ = bh_fdr(p_map)
        layers["q_value"] = q_map
        # The class follows the contract wording strictly: q < 0.05. The
        # multiplier reject mask is not used directly because it can reject at
        # q == 0.05.
        significant = q_map[rr, cc] < Q_THRESHOLD
        slopes = layers["sen_slope"][rr, cc]
        trend_class[rr, cc] = np.where(
            significant & (slopes > 0),
            TREND_INCREASE,
            np.where(significant & (slopes < 0), TREND_DECREASE, TREND_NOT_SIGNIFICANT),
        )
        extras["p_value"] = p_map
    else:
        # Empty family (no evaluated cells): q_value stays all-NaN and every
        # masked cell is already INSUFFICIENT_DATA (nothing was evaluated).
        layers["q_value"] = np.full((n_lat, n_lon), np.nan)
        extras["p_value"] = layers["q_value"]

    layers["trend_class"] = trend_class
    assert set(layers) == set(FLOAT_LAYERS) | set(CLASS_LAYERS)
    return layers, extras
