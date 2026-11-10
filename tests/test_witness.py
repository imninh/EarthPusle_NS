"""P13 witness tests: conversions, conservative regridding, mask, trend class."""

from __future__ import annotations

import numpy as np
import pytest

from earthpulse import contract
from earthpulse.stats.trend import trend_grid
from earthpulse.witness import (
    apply_mask,
    area_weighted_regrid,
    build_overlap_weights,
    convert_units,
    load_witness_config,
)


def test_unit_conversions() -> None:
    assert convert_units(np.array([300.0]), "kelvin_to_celsius", 2024, 2)[0] == pytest.approx(
        26.85
    )
    assert convert_units(np.array([0.001]), "kg_per_kg_to_g_per_kg", 2024, 2)[0] == pytest.approx(
        1.0
    )
    # 1 mm/hr in January is not used here; EVLAND is per second.
    evap = convert_units(np.array([1e-5]), "per_second_to_per_month", 2024, 4)[0]
    assert evap == pytest.approx(1e-5 * 30 * 86400)  # 25.92 mm
    gpcp = convert_units(np.array([2.0]), "per_day_to_per_month", 2024, 2)[0]
    assert gpcp == pytest.approx(58.0)  # 2 mm/day × 29 days
    assert convert_units(np.array([0.4]), "identity", 2024, 2)[0] == pytest.approx(0.4)


def test_regrid_conserves_constant_and_linear_latitude() -> None:
    lat = np.arange(89.75, -90.0, -0.5)  # GPCP-style 0.5° centres
    lon = np.arange(-179.75, 180.0, 0.5)
    weights = build_overlap_weights(lat, lon)

    constant = area_weighted_regrid(
        np.ones((lat.size, lon.size)), weights, (lat.size, lon.size)
    )
    assert np.allclose(constant, 1.0)

    linear = np.broadcast_to(lat[:, None], (lat.size, lon.size)).astype(float)
    regridded = area_weighted_regrid(
        linear, weights, (lat.size, lon.size)
    )
    assert regridded.shape == (contract.N_ROWS, contract.N_COLS)
    # The cos-lat weighted mean over 44.5..45.5 is close to, but not exactly,
    # the plain 45.5 arithmetic mean.
    assert regridded[44, 0] == pytest.approx(45.5, abs=0.01)


def test_merra2_grid_constant() -> None:
    lat = np.arange(-90.0, 90.5, 0.5)
    lon = np.arange(-180.0, 180.0, 0.625)
    weights = build_overlap_weights(lat, lon)
    result = area_weighted_regrid(
        np.ones((lat.size, lon.size)), weights, (lat.size, lon.size)
    )
    assert np.allclose(result, 1.0)


def test_mask_sets_outside_nan() -> None:
    values = np.ones((contract.N_ROWS, contract.N_COLS))
    mask = np.zeros((contract.N_ROWS, contract.N_COLS), dtype=bool)
    mask[10:12, 20:22] = True
    masked = apply_mask(values, mask)
    assert np.isfinite(masked[mask]).all()
    assert np.isnan(masked[~mask]).all()
    with pytest.raises(ValueError):
        apply_mask(np.ones((2, 2)), mask)


def test_config_mirrors_contract() -> None:
    config = load_witness_config()
    assert set(config["variables"]) == set(contract.WITNESSES)
    for variable_id, (short_name, version, source_variable) in contract.WITNESSES.items():
        entry = config["variables"][variable_id]
        assert entry["product"] == short_name
        assert str(config["products"][short_name]["version"]) == version
        assert entry["source_variable"] == source_variable


def test_same_synthetic_trend_gives_same_class() -> None:
    n_time, n_lat, n_lon = 120, 5, 5
    x = np.arange(n_time, dtype=float)
    trend = 0.01 * x
    rng = np.random.default_rng(0)
    noise = rng.normal(0.0, 0.02, (n_time, n_lat, n_lon))
    anomaly = trend[:, None, None] + noise
    mask = np.zeros((n_lat, n_lon), dtype=bool)
    mask[1:4, 1:4] = True

    main, _ = trend_grid(anomaly, mask)
    witness, _ = trend_grid(anomaly, mask)
    assert np.array_equal(main["trend_class"], witness["trend_class"])
    assert np.allclose(
        main["sen_slope_decade"], witness["sen_slope_decade"], equal_nan=True
    )
