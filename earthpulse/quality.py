"""P08 T2: step-like change detection for the schema-1.2 quality layers.

The method follows ``docs/DATA_CONTRACT.md`` §12 and
``docs/packages/specs/P08_quality_and_rerun.md`` T2:

1. annual means of the monthly anomalies inside the window;
2. Pettitt change-point test, approximate ``p = 2 exp(-6 K^2 / (n^3+n^2))``;
3. BH-FDR over the evaluated cells of one variable x window;
4. a two-mean step at the Pettitt break must fit better than a linear trend by
   ``BIC(linear) - BIC(step) >= 2``;
5. flag 1 when both conditions hold, flag 2 when the break year also falls in
   a documented forcing-change period of the source product.

The module computes diagnostics but writes no files; :mod:`earthpulse.export`
writes the contract layers.
"""

from __future__ import annotations

import numpy as np

from earthpulse import contract
from earthpulse.stats.fdr import bh_fdr

# Below this many valid annual means the Pettitt/step comparison is not
# meaningful. Real cells pass the monthly 80%/10-year eligibility rule, which
# supplies 12 or 24 annual means; this is a defensive guard for partial cells.
MIN_ANNUAL_MEANS = 4


def annual_means(
    anomaly: np.ndarray, years: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Annual means of a monthly anomaly cube.

    Args:
        anomaly: ``(time, lat, lon)`` array; NaN = missing month.
        years: integer calendar year for each time step.

    Returns:
        ``(means, unique_years)`` where ``means`` has shape
        ``(n_years, lat, lon)`` and a NaN where a year has no valid month.
    """

    values = np.asarray(anomaly, dtype=float)
    year_values = np.asarray(years)
    if values.ndim != 3:
        raise ValueError("anomaly must have shape (time, lat, lon)")
    if year_values.shape != (values.shape[0],):
        raise ValueError("years must have one entry per time step")

    unique_years = np.unique(year_values)
    means = np.full((unique_years.size, *values.shape[1:]), np.nan, dtype=float)
    for index, year in enumerate(unique_years):
        block = values[year_values == year]
        valid = np.isfinite(block)
        count = valid.sum(axis=0)
        total = np.where(valid, block, 0.0).sum(axis=0)
        with np.errstate(invalid="ignore", divide="ignore"):
            means[index] = np.where(count > 0, total / count, np.nan)
    return means, unique_years


def pettitt_test(series: np.ndarray) -> dict[str, float | int]:
    """Pettitt change-point test for one finite annual series.

    Returns ``K``, approximate ``p``, the zero-based change index ``t`` (the
    last year before the break) and ``n``. The break year is the next year.
    """

    values = np.asarray(series, dtype=float)
    if values.ndim != 1 or values.size < 2 or not np.all(np.isfinite(values)):
        raise ValueError("Pettitt needs a finite one-dimensional series of length >= 2")

    n = values.size
    u = np.empty(n - 1, dtype=float)
    for t in range(n - 1):
        u[t] = np.sign(values[t + 1 :][None, :] - values[: t + 1][:, None]).sum()

    change_index = int(np.argmax(np.abs(u)))
    k = float(abs(u[change_index]))
    p = min(1.0, 2.0 * np.exp(-6.0 * k * k / (n**3 + n**2)))
    return {"K": k, "p": float(p), "change_index": change_index, "n": n}


def delta_bic(series: np.ndarray, change_index: int, years: np.ndarray) -> float:
    """``BIC(linear trend) - BIC(two-mean step)`` for one annual series.

    Both models have two mean parameters (slope/intercept versus two means);
    the common variance term cancels. ``change_index`` is the last year before
    the step. The linear trend is fitted at the real calendar ``years`` so a
    missing year is a real two-year gap, not a single index step. A positive
    value favours the step; the contract requires >= 2.
    """

    values = np.asarray(series, dtype=float)
    if values.ndim != 1 or values.size < 3 or not np.all(np.isfinite(values)):
        return float("nan")
    n = values.size
    if change_index < 0 or change_index >= n - 1:
        return float("nan")

    time_values = np.asarray(years, dtype=float)
    if time_values.ndim != 1 or time_values.shape != values.shape:
        return float("nan")
    if not np.all(np.isfinite(time_values)):
        return float("nan")
    # Offset only (an affine change of the time axis leaves both fits and the
    # BIC difference unchanged); gaps between calendar years are preserved.
    x = time_values - time_values.min()
    try:
        coefficients = np.polyfit(x, values, 1)
        linear_residual = values - np.polyval(coefficients, x)
        sse_linear = float(np.sum(linear_residual**2))
    except (np.linalg.LinAlgError, ValueError):
        return float("nan")

    first = values[: change_index + 1]
    second = values[change_index + 1 :]
    sse_step = float(np.sum((first - first.mean()) ** 2) + np.sum((second - second.mean()) ** 2))

    tiny = 1e-12
    bic_linear = n * np.log(max(sse_linear, tiny) / n) + 2.0 * np.log(n)
    bic_step = n * np.log(max(sse_step, tiny) / n) + 2.0 * np.log(n)
    return float(bic_linear - bic_step)


def quality_grid(
    annual: np.ndarray,
    years: np.ndarray,
    trend_class: np.ndarray,
    mask: np.ndarray,
    product: str,
) -> dict[str, np.ndarray]:
    """Compute ``quality_flag`` and ``breakpoint_year`` for one variable/window.

    Args:
        annual: ``(n_years, lat, lon)`` annual means of the window's anomalies.
        years: calendar year for each annual layer.
        trend_class: P03 ``trend_class`` grid; ``-9`` marks insufficient data.
        mask: common land mask; outside -> ``-99``.
        product: source product short name (for the known-forcing range).

    Returns:
        Dict with int8 ``quality_flag``, float32 ``breakpoint_year`` and the
        diagnostic float32 layers ``pettitt_p`` and ``delta_bic``.
    """

    annual_values = np.asarray(annual, dtype=float)
    if annual_values.ndim != 3:
        raise ValueError("annual must have shape (year, lat, lon)")
    if annual_values.shape[0] != len(years):
        raise ValueError("years does not match the annual layers")
    classes = np.asarray(trend_class)
    domain = np.asarray(mask, dtype=bool)
    if classes.shape != domain.shape or annual_values.shape[1:] != domain.shape:
        raise ValueError("trend_class, mask and annual grid shapes differ")

    shape = domain.shape
    p_map = np.full(shape, np.nan, dtype=float)
    delta_map = np.full(shape, np.nan, dtype=float)
    break_map = np.full(shape, np.nan, dtype=float)
    flags = np.where(domain, contract.QUALITY_NONE, contract.OUTSIDE_DOMAIN).astype(
        np.int8
    )

    rows, cols = np.nonzero(domain)
    for row, col in zip(rows, cols):
        if classes[row, col] == contract.INSUFFICIENT_DATA:
            flags[row, col] = contract.INSUFFICIENT_DATA
            continue

        series = annual_values[:, row, col]
        valid = np.isfinite(series)
        if int(valid.sum()) < MIN_ANNUAL_MEANS:
            flags[row, col] = contract.INSUFFICIENT_DATA
            continue

        values = series[valid]
        valid_years = np.asarray(years)[valid]
        result = pettitt_test(values)
        change_index = int(result["change_index"])
        p_map[row, col] = float(result["p"])
        delta_map[row, col] = delta_bic(values, change_index, valid_years)
        break_map[row, col] = float(valid_years[change_index + 1])

    q_map, _ = bh_fdr(p_map)
    flagged = (
        np.isfinite(q_map)
        & (q_map < contract.QUALITY_FDR_Q)
        & np.isfinite(delta_map)
        & (delta_map >= contract.QUALITY_MIN_DELTA_BIC)
    )
    flags[flagged] = contract.QUALITY_STEP
    forcing = contract.KNOWN_FORCING_CHANGES.get(product)
    if forcing is not None:
        low, high = forcing
        in_period = flagged & (break_map >= low) & (break_map <= high)
        flags[in_period] = contract.QUALITY_STEP_KNOWN_FORCING

    breakpoint = np.where(flags >= contract.QUALITY_STEP, break_map, np.nan).astype(
        np.float32
    )
    return {
        "quality_flag": flags,
        "breakpoint_year": breakpoint,
        "pettitt_p": p_map.astype(np.float32),
        "delta_bic": delta_map.astype(np.float32),
    }
