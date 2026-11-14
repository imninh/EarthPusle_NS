"""P27/A4: years needed to detect a trend (Weatherhead et al., 1998).

Formula confirmed against the paper's restatements (Weatherhead et al. 1998,
J. Geophys. Res. 103(D14), doi:10.1029/98JD00995; Sutton et al. 2019,
Earth Syst. Sci. Data 11, 421-439, Eqs. 1-3; Wahyudi et al. 2025,
Biogeochemistry, Eqs. 3-5):

    n* = [ (3.3 * sigma_N / |omega_0|) * sqrt((1 + phi) / (1 - phi)) ]^(2/3)
    B  = 4 / (3 * sqrt(m)) * sqrt((1 + phi) / (1 - phi))
    n*_lo = n* * exp(-B),  n*_hi = n* * exp(B)

where m is the number of monthly residuals and phi is their lag-1
autocorrelation. The 3.3 constant is the 95% confidence / 90% power factor
used by the paper. This is an estimate if the same rate continued and the
natural variability stayed the same; it is not a forecast.
"""

from __future__ import annotations

import numpy as np

PHI_MAX = 0.95
MIN_VALID_FRACTION = 0.8
MIN_RESIDUAL_MONTHS = 3


def _nan_result() -> dict[str, float]:
    return {
        "n_star": float("nan"),
        "lower": float("nan"),
        "upper": float("nan"),
        "sigma": float("nan"),
        "phi": float("nan"),
    }


def years_to_detect(
    slope_per_year: float, residual: np.ndarray | list[float]
) -> dict[str, float]:
    """Weatherhead et al. (1998) estimate for one monthly series.

    Args:
        slope_per_year: trend magnitude per year (sign ignored).
        residual: monthly noise with the fitted trend already removed. NaNs
            are skipped; valid values stay in time order.

    Returns:
        ``n_star``, ``lower`` and ``upper`` in years, plus ``sigma`` (monthly
        noise standard deviation, ddof=1) and ``phi`` (lag-1 autocorrelation,
        clipped to [0, 0.95]). Slope 0 gives ``+inf``. Non-finite inputs or
        fewer than three residuals give NaNs.
    """

    values = np.asarray(residual, dtype=float).ravel()
    values = values[np.isfinite(values)]
    slope = float(slope_per_year)
    if not np.isfinite(slope):
        return _nan_result()
    if values.size < MIN_RESIDUAL_MONTHS:
        return _nan_result()

    sigma = float(np.std(values, ddof=1))
    if not np.isfinite(sigma) or sigma <= 0:
        # A noise-free residual has no natural variability to overcome.
        sigma = max(sigma, 0.0)

    centred = values - float(np.mean(values))
    denominator = float(np.dot(centred, centred))
    if denominator <= 0:
        phi = 0.0
    else:
        phi = float(np.dot(centred[1:], centred[:-1]) / denominator)
        phi = float(np.clip(phi, 0.0, PHI_MAX))

    if slope == 0:
        infinite = float("inf")
        return {
            "n_star": infinite,
            "lower": infinite,
            "upper": infinite,
            "sigma": sigma,
            "phi": phi,
        }

    ratio = (1.0 + phi) / (1.0 - phi)
    if sigma == 0:
        n_star = 0.0
    else:
        n_star = float(((3.3 * sigma / abs(slope)) * np.sqrt(ratio)) ** (2.0 / 3.0))
    factor_b = float(4.0 / (3.0 * np.sqrt(values.size)) * np.sqrt(ratio))
    return {
        "n_star": n_star,
        "lower": float(n_star * np.exp(-factor_b)),
        "upper": float(n_star * np.exp(factor_b)),
        "sigma": sigma,
        "phi": phi,
    }
