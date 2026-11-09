"""P03 gaps comparison study (spec section 3.3) - numbers for the P03 report.

Question: how much do the results differ when a monthly series has 10% random
gaps, given that pymannkendall runs on the valid points in time order (no
explicit time positions)?

Measured on 200 seeded synthetic monthly series (288 months) with a known
linear trend + noise, comparing:
- Sen's slope using real time positions (engine) vs the naive evenly spaced
  variant (valid points assumed contiguous),
- mean absolute slope error against the true trend,
- Hamed-Rao p-value and trend class agreement between the gapped series and
  the same series without gaps.

Run:  .venv/Scripts/python scripts/p03_gap_study.py
"""

from __future__ import annotations

import numpy as np
import pymannkendall as mk

from earthpulse.stats.trend import (
    analyse_series,
    sen_slope_evenly_spaced,
    sen_slope_real_time,
)

N = 288
T_YEARS = np.arange(N, dtype=float) / 12.0
TRUTH = 0.02  # per year
SIGMA = 0.1
GAP_FRACTION = 0.10
SEEDS = 200


def main() -> None:
    err_real, err_even = [], []
    slope_paired_maxdiff = 0.0
    p_maxdiff = 0.0
    n_sig_agree = n_sig_disagree = 0

    for seed in range(SEEDS):
        rng = np.random.default_rng(seed)
        clean = TRUTH * T_YEARS + rng.normal(0.0, SIGMA, size=N)

        gapped = clean.copy()
        drop = rng.random(N) < GAP_FRACTION
        gapped[drop] = np.nan

        t_valid = T_YEARS[~drop]
        x_valid = gapped[~drop]
        slope_real = sen_slope_real_time(x_valid, t_valid)
        slope_even = sen_slope_evenly_spaced(x_valid)
        err_real.append(abs(slope_real - TRUTH))
        err_even.append(abs(slope_even - TRUTH))

        res_gap = analyse_series(gapped)
        res_clean = analyse_series(clean)
        slope_paired_maxdiff = max(
            slope_paired_maxdiff, abs(res_gap["sen_slope"] - res_clean["sen_slope"])
        )
        p_maxdiff = max(p_maxdiff, abs(res_gap["p_value"] - res_clean["p_value"]))
        sig_gap = res_gap["p_value"] < 0.05
        sig_clean = res_clean["p_value"] < 0.05
        if sig_gap == sig_clean:
            n_sig_agree += 1
        else:
            n_sig_disagree += 1

    print(f"series: {SEEDS} (seed 0..{SEEDS - 1}), n={N}, truth={TRUTH}/yr, "
          f"noise sigma={SIGMA}, gaps={GAP_FRACTION:.0%}")
    print(f"mean |slope error| real-time positions : {np.mean(err_real):.6f} /yr")
    print(f"mean |slope error| evenly spaced      : {np.mean(err_even):.6f} /yr")
    print(f"max |slope(gapped) - slope(clean)|    : {slope_paired_maxdiff:.6f} /yr")
    print(f"max |p(gapped) - p(clean)|            : {p_maxdiff:.6f}")
    print(f"significance (p<0.05) agreement gapped vs clean: "
          f"{n_sig_agree}/{SEEDS} agree, {n_sig_disagree} disagree")


if __name__ == "__main__":
    main()
