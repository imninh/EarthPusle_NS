"""Write tests/fixtures/stats_reference.json (P03-owned fixture).

Five fixed synthetic monthly series (fixed seeds) with the Python engine's
reference values: Sen's slope (per year, real time positions t = index/12),
original Mann-Kendall p-value and Kendall tau. P05 (Region Explorer) uses this
file to verify its TypeScript port of the statistics.

Regenerate with:  .venv/Scripts/python scripts/p03_make_reference.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from earthpulse.contract import N_MONTHS
from earthpulse.stats.trend import analyse_series

PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = PROJECT_ROOT / "tests" / "fixtures" / "stats_reference.json"
SEED = 20261109


def ar1(rng: np.random.Generator, phi: float, sigma: float, n: int) -> np.ndarray:
    eps = rng.normal(0.0, sigma, size=n)
    x = np.empty(n)
    x[0] = eps[0] / np.sqrt(1 - phi**2)
    for k in range(1, n):
        x[k] = phi * x[k - 1] + eps[k]
    return x


def build_series() -> dict[str, np.ndarray]:
    rng = np.random.default_rng(SEED)
    t = np.arange(N_MONTHS, dtype=float) / 12.0
    months = np.arange(N_MONTHS) % 12
    return {
        # linear increase, moderate noise
        "linear_increase": 0.02 * t + rng.normal(0.0, 0.05, size=N_MONTHS),
        # linear decrease, moderate noise
        "linear_decrease": -0.015 * t + rng.normal(0.0, 0.05, size=N_MONTHS),
        # white noise, no trend
        "no_trend_white_noise": rng.normal(0.0, 0.2, size=N_MONTHS),
        # AR(1) noise, no trend
        "no_trend_ar1": ar1(rng, 0.6, 0.15, N_MONTHS),
        # seasonal cycle + small trend (values, NOT anomalies)
        "seasonal_plus_trend": 0.01 * t
        + 5.0 * np.sin(2 * np.pi * months / 12.0)
        + rng.normal(0.0, 0.3, size=N_MONTHS),
    }


HR_SEED = 20261114


def build_hamed_rao_series() -> dict[str, np.ndarray]:
    """Series for the Hamed-Rao reference (A1). Separate generator so the series above never change."""
    rng = np.random.default_rng(HR_SEED)
    n = N_MONTHS
    t = np.arange(n, dtype=float) / 12.0
    out: dict[str, np.ndarray] = {
        "hr_white_noise": rng.normal(0.0, 0.2, size=n),
        "hr_white_noise_trend": 0.02 * t + rng.normal(0.0, 0.2, size=n),
        "hr_ar1_phi03": ar1(rng, 0.3, 0.15, n),
        "hr_ar1_phi03_trend": 0.015 * t + ar1(rng, 0.3, 0.15, n),
        "hr_ar1_phi06": ar1(rng, 0.6, 0.15, n),
        "hr_ar1_phi06_trend": 0.015 * t + ar1(rng, 0.6, 0.15, n),
    }
    gapped = 0.01 * t + ar1(rng, 0.5, 0.15, n)
    gapped[rng.choice(n, size=40, replace=False)] = np.nan
    out["hr_ar1_phi05_trend_nan_gaps"] = gapped
    return out


def hamed_rao_entries() -> list[dict]:
    import pymannkendall as mk

    entries = []
    for name, values in build_hamed_rao_series().items():
        r = mk.hamed_rao_modification_test(values)
        o = mk.original_test(values)
        entries.append(
            {
                "name": name,
                "n": int(values.size),
                "n_valid": int(np.isfinite(values).sum()),
                # NaN is written as null (valid JSON)
                "values": [None if not np.isfinite(v) else float(v) for v in values],
                "p": float(r.p),
                "z": float(r.z),
                "tau": float(r.Tau),
                "s": float(r.s),
                "var_s": float(r.var_s),
                "var_s_original": float(o.var_s),
            }
        )
    return entries


def main() -> None:
    series = build_series()
    out = {
        "synthetic": True,
        "purpose": (
            "Reference values for the P05 TypeScript port of the P03 statistics: "
            "recompute Sen's slope, original Mann-Kendall p-value and tau from "
            "values and compare. Series are synthetic test data, not NASA results."
        ),
        "conventions": {
            "n_months": N_MONTHS,
            "t_years": "index / 12 (monthly, first value at t=0)",
            "sen_slope": "median pairwise slope at real time positions (year-1)",
            "p_value_original": "unmodified Mann-Kendall test on the values as given",
            "mk_tau": "Kendall tau of the unmodified Mann-Kendall test",
            "seed": SEED,
        },
        "series": [],
    }
    for name, values in series.items():
        res = analyse_series(values)
        out["series"].append(
            {
                "name": name,
                "n": int(values.size),
                "values": [float(v) for v in values],
                "sen_slope_per_year": float(res["sen_slope"]),
                "p_value_original": float(res["p_value_original"]),
                "mk_tau": float(res["mk_tau_original"]),
            }
        )
    out["hamed_rao"] = {
        "source": "pymannkendall.hamed_rao_modification_test (alpha 0.05, lag None); NaN skipped; synthetic series",
        "seed": HR_SEED,
        "series": hamed_rao_entries(),
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"wrote {OUT_PATH}")
    for s in out["series"]:
        print(
            f"  {s['name']}: slope={s['sen_slope_per_year']:+.6f} "
            f"p_orig={s['p_value_original']:.5f} tau={s['mk_tau']:+.5f}"
        )


if __name__ == "__main__":
    main()
