"""EarthPulse statistical engine (P03): trends, significance, associations.

Public API (docs/packages/specs/P03_statistical_engine.md):

- :func:`earthpulse.stats.trend.analyse_series` - single-series trend statistics
- :func:`earthpulse.stats.trend.trend_grid` - vectorized grid driver
- :func:`earthpulse.stats.fdr.bh_fdr` - Benjamini-Hochberg over evaluated cells
- :func:`earthpulse.stats.association.correlation_grid` - per-cell Spearman maps
- :func:`earthpulse.stats.run.run_trends` / :func:`earthpulse.stats.run.run_correlations`
  - read P02 outputs, write the contract NetCDFs under data/processed/
"""

from earthpulse.stats.association import correlation_grid, spearman_nan_safe
from earthpulse.stats.fdr import bh_fdr
from earthpulse.stats.run import (
    compute_trend,
    load_anomalies,
    load_common_mask,
    parse_pair,
    run_correlations,
    run_trends,
    window_slice,
)
from earthpulse.stats.trend import (
    analyse_series,
    sen_slope_evenly_spaced,
    sen_slope_real_time,
    trend_grid,
)

__all__ = [
    "analyse_series",
    "trend_grid",
    "bh_fdr",
    "correlation_grid",
    "spearman_nan_safe",
    "load_anomalies",
    "load_common_mask",
    "parse_pair",
    "compute_trend",
    "run_correlations",
    "run_trends",
    "window_slice",
    "sen_slope_evenly_spaced",
    "sen_slope_real_time",
]
