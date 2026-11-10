"""P08 T2 tests for the step-like change quality layers (synthetic only)."""

from __future__ import annotations

import numpy as np

from earthpulse import contract
from earthpulse.quality import (
    annual_means,
    delta_bic,
    pettitt_test,
    quality_grid,
)

YEARS = np.arange(2001, 2025)


def step_series() -> np.ndarray:
    return np.r_[np.zeros(10), np.full(14, 10.0)]


def linear_series() -> np.ndarray:
    return np.linspace(0.0, 10.0, YEARS.size)


def test_annual_means_ignores_missing_months() -> None:
    anomaly = np.full((5, 1, 1), np.nan)
    years = np.array([2001, 2001, 2002, 2002, 2002])
    anomaly[0, 0, 0] = 1.0
    anomaly[2, 0, 0] = 3.0
    anomaly[3, 0, 0] = 5.0
    means, unique = annual_means(anomaly, years)
    assert unique.tolist() == [2001, 2002]
    assert means[0, 0, 0] == 1.0
    assert means[1, 0, 0] == 4.0
    assert len(means) == 2


def test_pettitt_and_delta_bic_step_vs_linear() -> None:
    step = step_series()
    result = pettitt_test(step)
    assert result["change_index"] == 9  # last year before the 2011 step
    assert result["p"] < 0.05
    assert delta_bic(step, int(result["change_index"]), YEARS) >= 2.0

    linear = linear_series()
    result = pettitt_test(linear)
    assert delta_bic(linear, int(result["change_index"]), YEARS) < 2.0


def test_noise_is_flagged_at_most_5_percent() -> None:
    rng = np.random.default_rng(42)
    hits = 0
    for _ in range(200):
        values = rng.normal(size=YEARS.size)
        result = pettitt_test(values)
        if (
            result["p"] < contract.QUALITY_FDR_Q
            and delta_bic(values, int(result["change_index"]), YEARS)
            >= contract.QUALITY_MIN_DELTA_BIC
        ):
            hits += 1
    assert hits / 200 <= 0.05


def _quality_fixture() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    annual = np.full((YEARS.size, 1, 4), np.nan)
    annual[:, 0, 0] = step_series()
    annual[:, 0, 1] = linear_series()
    annual[:, 0, 2] = step_series()
    annual[:, 0, 3] = step_series()
    trend_class = np.zeros((1, 4), dtype=np.int8)
    trend_class[0, 2] = contract.INSUFFICIENT_DATA
    mask = np.array([[True, True, True, False]])
    return annual, trend_class, mask


def test_gapped_linear_series_uses_calendar_years() -> None:
    """A missing year is a two-year gap in the linear fit, not a single step.

    Regression for P17 finding 2: with index time the same series looked like a
    code-2 step; calendar time keeps ΔBIC below 2 and the flag at 0.
    """
    rng = np.random.default_rng(23)
    years = np.array(
        [2001, 2002, 2003, 2004, 2005, 2006, 2008, 2009, 2010, 2011, 2012],
        dtype=int,
    )
    values = 0.3 * (years - 2001) + rng.normal(0, 0.4, years.size)
    result = pettitt_test(values)
    change_index = int(result["change_index"])
    assert result["p"] < 0.05
    assert delta_bic(values, change_index, years) < contract.QUALITY_MIN_DELTA_BIC

    annual = values.reshape(-1, 1, 1)
    trend_class = np.array([[contract.TREND_NOT_SIGNIFICANT]], dtype=np.int8)
    mask = np.array([[True]])
    quality = quality_grid(annual, years, trend_class, mask, "GLDAS_NOAH10_M")
    assert quality["quality_flag"][0, 0] == contract.QUALITY_NONE


def test_quality_grid_gldas_known_forcing_period() -> None:
    annual, trend_class, mask = _quality_fixture()
    result = quality_grid(
        annual, YEARS, trend_class, mask, product="GLDAS_NOAH10_M"
    )
    flags = result["quality_flag"]
    breakpoint = result["breakpoint_year"]
    assert flags[0, 0] == contract.QUALITY_STEP_KNOWN_FORCING
    assert flags[0, 1] == contract.QUALITY_NONE  # linear trend is not a step
    assert flags[0, 2] == contract.INSUFFICIENT_DATA
    assert flags[0, 3] == contract.OUTSIDE_DOMAIN
    assert breakpoint[0, 0] == 2011.0
    assert np.isnan(breakpoint[0, 1])
    assert np.isnan(breakpoint[0, 2])
    assert np.isnan(breakpoint[0, 3])
    assert result["quality_flag"].dtype == np.int8
    assert result["breakpoint_year"].dtype == np.float32


def test_quality_grid_imerg_same_step_is_code_1() -> None:
    annual, trend_class, mask = _quality_fixture()
    result = quality_grid(
        annual, YEARS, trend_class, mask, product="GPM_3IMERG"
    )
    assert result["quality_flag"][0, 0] == contract.QUALITY_STEP
    assert result["breakpoint_year"][0, 0] == 2011.0
