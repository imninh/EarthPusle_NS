"""Smoke test: the scientific stack imports and basic trend tooling works.

Uses synthetic data only. This is not a NASA result.
"""

import numpy as np


def test_imports():
    import netCDF4  # noqa: F401
    import pandas  # noqa: F401
    import scipy  # noqa: F401
    import statsmodels  # noqa: F401
    import xarray  # noqa: F401


def test_sen_slope_on_synthetic_trend():
    import pymannkendall as mk

    rng = np.random.default_rng(0)
    x = 0.5 * np.arange(120) + rng.normal(0, 1, 120)
    result = mk.original_test(x)
    assert result.trend == "increasing"
    assert abs(result.slope - 0.5) < 0.05
