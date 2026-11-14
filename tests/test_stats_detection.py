"""P27/A4 tests: Weatherhead et al. (1998) years-to-detect estimate."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from scipy import stats

from earthpulse.stats.detection import years_to_detect

FIXTURE = Path(__file__).parent / "fixtures" / "detection_reference.json"


def _ar1_noise(n_months: int, phi: float, rng: np.random.Generator) -> np.ndarray:
    innovation = np.sqrt(1.0 - phi * phi)
    noise = np.empty(n_months, dtype=float)
    noise[0] = rng.normal(0.0, 1.0)
    for index in range(1, n_months):
        noise[index] = phi * noise[index - 1] + rng.normal(0.0, innovation)
    return noise


def _detected_by_ar1_t_test(slope: float, series: np.ndarray, phi: float) -> bool:
    t = np.arange(series.size, dtype=float) / 12.0
    design = np.column_stack([np.ones_like(t), t])
    beta, *_ = np.linalg.lstsq(design, series, rcond=None)
    residual = series - design @ beta
    centred = residual - residual.mean()
    denominator = float(np.dot(centred, centred))
    phi_hat = 0.0 if denominator <= 0 else float(np.dot(centred[1:], centred[:-1]) / denominator)
    phi_hat = float(np.clip(phi_hat, 0.0, 0.95))
    sigma = float(np.std(residual, ddof=2))
    sxx = float(np.sum((t - t.mean()) ** 2))
    variance = sigma * sigma * (1.0 + phi_hat) / (1.0 - phi_hat) / sxx
    statistic = beta[1] / np.sqrt(variance)
    p_value = 2.0 * stats.t.sf(abs(statistic), df=series.size - 2)
    return bool(p_value < 0.05)


def test_formula_reference_values():
    # Hand-checkable values of the published formula: sigma=1, phi=0, slope=1.
    result = years_to_detect(1.0, np.zeros(1))
    assert np.isnan(result["n_star"])  # too few residuals is not evaluated

    rng = np.random.default_rng(7)
    residual = rng.normal(0.0, 1.0, 120)
    result = years_to_detect(1.0, residual)
    ratio = (1.0 + result["phi"]) / (1.0 - result["phi"])
    expected = ((3.3 * result["sigma"] / 1.0) * np.sqrt(ratio)) ** (2.0 / 3.0)
    assert result["n_star"] == pytest.approx(expected, rel=1e-12)
    b = 4.0 / (3.0 * np.sqrt(120.0)) * np.sqrt(ratio)
    assert result["lower"] == pytest.approx(expected * np.exp(-b), rel=1e-12)
    assert result["upper"] == pytest.approx(expected * np.exp(b), rel=1e-12)
    assert 0.0 <= result["phi"] <= 0.95


def test_zero_slope_is_infinite():
    residual = np.linspace(-1.0, 1.0, 60)
    result = years_to_detect(0.0, residual)
    assert np.isinf(result["n_star"])
    assert np.isinf(result["lower"])
    assert np.isinf(result["upper"])
    assert np.isfinite(result["sigma"])
    assert np.isfinite(result["phi"])


def test_nan_handling():
    assert all(np.isnan(value) for value in years_to_detect(float("nan"), np.arange(60.0)).values())
    assert all(
        np.isnan(value)
        for value in years_to_detect(1.0, np.array([np.nan, np.nan, np.nan])).values()
    )
    mixed = years_to_detect(1.0, np.array([1.0, 2.0, np.nan, 3.0, 4.0, 5.0]))
    assert np.isfinite(mixed["n_star"])
    assert np.isfinite(mixed["sigma"])
    assert 0.0 <= mixed["phi"] <= 0.95


def test_fixture_matches_python():
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for case in payload["cases"]:
        residual = np.array(
            [np.nan if value is None else value for value in case["residual"]], dtype=float
        )
        result = years_to_detect(case["slope_per_year"], residual)
        for key in ("n_star", "lower", "upper", "sigma", "phi"):
            assert result[key] == pytest.approx(
                case["expected"][key], rel=1e-12, abs=1e-12
            ), f"{case['name']}: {key}"


def test_monte_carlo_detection_rate_at_n_star():
    # Report the measured rate; the test bounds only catch a broken formula.
    slope = 1.0
    seeds = 400
    measured: dict[float, float] = {}
    for phi in (0.0, 0.3, 0.6):
        ratio = (1.0 + phi) / (1.0 - phi)
        n_star = ((3.3 / slope) * np.sqrt(ratio)) ** (2.0 / 3.0)
        months = int(round(n_star * 12.0))
        rng = np.random.default_rng(20261114 + int(phi * 100))
        detected = 0
        for _ in range(seeds):
            series = slope * np.arange(months) / 12.0 + _ar1_noise(months, phi, rng)
            detected += int(_detected_by_ar1_t_test(slope, series, phi))
        measured[phi] = detected / seeds
        print(
            f"Monte-Carlo phi={phi:.1f}: n*={n_star:.2f} years, "
            f"months={months}, detected {detected}/{seeds} = {measured[phi]:.3f}"
        )
    for phi, rate in measured.items():
        assert 0.80 <= rate <= 0.98, f"phi={phi}: measured detection rate {rate:.3f}"
