"""P02 tests for earthpulse.harmonize (synthetic data only, no network)."""

from __future__ import annotations

import numpy as np
import pytest
import xarray as xr

from earthpulse import contract
from earthpulse.grid import target_grid
from earthpulse.harmonize import (
    convert_units,
    expected_months,
    hours_in_month,
    load_registry,
    mask_fill,
    month_of_time_value,
    raw_file_pattern,
    seconds_in_month,
    transform_month,
)


# ---------------------------------------------------------------------------
# Calendar conversions
# ---------------------------------------------------------------------------


def test_hours_in_month_exact():
    assert hours_in_month(2001, 1) == pytest.approx(744.0)  # 31 days
    assert hours_in_month(2024, 2) == pytest.approx(696.0)  # leap, 29 days
    assert hours_in_month(2023, 2) == pytest.approx(672.0)  # non-leap, 28 days
    assert hours_in_month(2001, 4) == pytest.approx(720.0)  # 30 days


def test_seconds_in_month_exact():
    assert seconds_in_month(2001, 4) == pytest.approx(30 * 86400.0)
    assert seconds_in_month(2024, 2) == pytest.approx(29 * 86400.0)


# ---------------------------------------------------------------------------
# Unit conversions (spec §4 numbers)
# ---------------------------------------------------------------------------


def _scalar_da(value: float) -> xr.DataArray:
    return xr.DataArray(np.full((2, 3), value))


def test_conversion_mm_per_hour_january_is_744():
    out = convert_units(_scalar_da(1.0), "per_hour_to_per_month", 2001, 1)
    assert np.allclose(out.values, 744.0)


def test_conversion_mm_per_hour_leap_february_is_696():
    out = convert_units(_scalar_da(1.0), "per_hour_to_per_month", 2024, 2)
    assert np.allclose(out.values, 696.0)


def test_conversion_kelvin_to_celsius():
    out = convert_units(_scalar_da(300.0), "kelvin_to_celsius", 2001, 1)
    assert np.allclose(out.values, 26.85)


def test_conversion_per_second_30_day_month():
    # 1e-5 kg m-2 s-1 in a 30-day month = 25.92 mm.
    out = convert_units(_scalar_da(1e-5), "per_second_to_per_month", 2001, 4)
    assert np.allclose(out.values, 25.92)


def test_conversion_kg_per_kg_to_g_per_kg():
    out = convert_units(_scalar_da(0.005), "kg_per_kg_to_g_per_kg", 2001, 1)
    assert np.allclose(out.values, 5.0)


def test_conversion_identity_and_unknown():
    out = convert_units(_scalar_da(7.5), "identity", 2001, 1)
    assert np.allclose(out.values, 7.5)
    with pytest.raises(ValueError, match="Unknown registry conversion"):
        convert_units(_scalar_da(1.0), "nonsense", 2001, 1)


# ---------------------------------------------------------------------------
# Fill masking
# ---------------------------------------------------------------------------


def test_fill_values_become_nan_and_never_enter_means():
    data = np.array([[10.0, 20.0, -9999.0], [30.0, -9999.0, 50.0]])
    da = xr.DataArray(data, dims=("lat", "lon"))
    masked = mask_fill(da, -9999.0)
    assert np.isnan(masked.values[0, 2]) and np.isnan(masked.values[1, 1])
    valid = masked.values[np.isfinite(masked.values)]
    assert valid.mean() == pytest.approx((10.0 + 20.0 + 30.0 + 50.0) / 4.0)


# ---------------------------------------------------------------------------
# Time handling
# ---------------------------------------------------------------------------


def test_month_of_time_value_datetime64_and_cftime():
    import cftime

    assert month_of_time_value(np.datetime64("2001-01-01")) == (2001, 1)
    assert month_of_time_value(np.datetime64("2024-12-31T23:00:00")) == (2024, 12)
    assert month_of_time_value(cftime.DatetimeJulian(2007, 3, 1)) == (2007, 3)


def test_expected_months_is_288_in_order():
    months = expected_months()
    assert len(months) == contract.N_MONTHS
    assert months[0] == (2001, 1) and months[-1] == (2024, 12)
    assert (2001, 2) in months and (2013, 1) in months
    labels = [f"{y:04d}-{m:02d}" for y, m in months]
    assert labels == sorted(labels)


def test_raw_file_patterns_match_p01_verified_names():
    assert raw_file_pattern("GLDAS_NOAH10_M", 2001, 1) == "GLDAS_NOAH10_M.A200101.*.nc4"
    pattern = raw_file_pattern("GPM_3IMERGM", 2001, 1)
    assert "3B-MO.MS.MRG.3IMERG.20010101-" in pattern
    with pytest.raises(ValueError):
        raw_file_pattern("UNKNOWN_PRODUCT", 2001, 1)


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


def test_registry_loads_with_seven_variables():
    registry = load_registry()
    assert len(registry["variables"]) == 7
    known = {
        "identity",
        "kelvin_to_celsius",
        "per_hour_to_per_month",
        "per_second_to_per_month",
        "kg_per_kg_to_g_per_kg",
    }
    for variable in registry["variables"]:
        assert variable["conversion"] in known
        assert variable["product"] in registry["products"]
    gldas = registry["products"]["GLDAS_NOAH10_M"]
    imerg = registry["products"]["GPM_3IMERGM"]
    assert gldas["fill_value"] == -9999.0
    assert imerg["fill_value"] == -9999.9
    assert imerg["open_with"]["group"] == "Grid"


# ---------------------------------------------------------------------------
# transform_month (in-memory synthetic arrays)
# ---------------------------------------------------------------------------


def _registry_pair(variable_id: str):
    registry = load_registry()
    variable = next(v for v in registry["variables"] if v["id"] == variable_id)
    product = registry["products"][variable["product"]]
    return variable, product


def test_transform_month_imerg_conversion_and_fill():
    """IMERG-like 0.1° array: fill masked, mm/hr -> mm/month, oriented."""
    variable, product = _registry_pair("precipitation")
    # Fine grid aligned to 1° block boundaries: rows 66-67 (lat
    # 23.95..22.05 descending), cols 192-193 (lon 12.05..13.95).
    fine_lat = np.array([23.95 - 0.1 * k for k in range(20)])  # descending
    fine_lon = np.array([12.05 + 0.1 * k for k in range(20)])
    values = np.full((20, 20), 1.0)  # 1 mm/hr everywhere
    values[0, 0] = -9999.9  # native fill value
    da = xr.DataArray(
        values, dims=("lat", "lon"), coords={"lat": fine_lat, "lon": fine_lon}
    )
    value, fraction = transform_month(da, variable, product, 2001, 1)

    # A regional array is reindexed onto the full contract 180x360 grid;
    # everything outside the region is NaN.
    assert value.shape == (contract.N_ROWS, contract.N_COLS)
    # The 20x20 fine region spans exactly the 1° cells rows 66-67, cols
    # 192-193. 1 mm/hr in January 2001 = 744 mm/month; the fill cell
    # (fraction 0.99 >= 0.5) never enters the mean.
    assert np.allclose(value.values[66:68, 192:194], 744.0)
    # 0.99 up to the cos(lat) weight variation inside the block.
    assert fraction.values[66, 192] == pytest.approx(0.99, abs=1e-3)
    assert np.isnan(value.values[0, 0])
    assert np.isnan(value.values[100, 100])


def test_transform_month_keeps_negative_evapotranspiration():
    """Spec T3.2: negative ET (dew/condensation) is valid — never clipped
    or masked; only the fill value becomes NaN."""
    variable, product = _registry_pair("evapotranspiration")
    lat = -59.5 + np.arange(150) * 1.0
    lon = -179.5 + np.arange(360) * 1.0
    values = np.full((150, 360), 1e-5)
    values[10, 10] = -2.96e-6  # condensation, seen in P01 samples
    values[20, 20] = -9999.0  # native fill
    da = xr.DataArray(
        values, dims=("lat", "lon"), coords={"lat": lat, "lon": lon}
    )
    value, fraction = transform_month(da, variable, product, 2001, 4)
    assert fraction is None
    # 1e-5 kg m-2 s-1 over 30 days = 25.92 mm/month; the negative value
    # keeps its sign: -2.96e-6 * 2592000 s = -7.672... mm.
    assert value.values[66, 192] == pytest.approx(25.92)
    negative = value.values[contract.lat_to_row(-59.5 + 10) ,
                            contract.lon_to_col(-179.5 + 10)]
    assert negative == pytest.approx(-2.96e-6 * seconds_in_month(2001, 4))
    assert negative < 0  # sign preserved
    assert np.isnan(value.values[contract.lat_to_row(-39.5), 20])  # fill -> NaN


def test_transform_month_gldas_kelvin_and_orientation():
    """GLDAS-like 1° array: 300 K -> 26.85 degC, flipped, full 180x360."""
    variable, product = _registry_pair("surface_skin_temperature")
    lat = -59.5 + np.arange(150) * 1.0  # ascending, native GLDAS extent
    lon = -179.5 + np.arange(360) * 1.0
    values = np.full((150, 360), 300.0)
    values[149, 0] = -9999.0  # native fill at the northmost GLDAS row (89.5)
    da = xr.DataArray(
        values, dims=("lat", "lon"), coords={"lat": lat, "lon": lon}
    )
    value, fraction = transform_month(da, variable, product, 2001, 7)
    assert fraction is None  # native 1°, no aggregation companion
    assert value.shape == (contract.N_ROWS, contract.N_COLS)
    grid_lat, grid_lon = target_grid()
    assert np.allclose(value["lat"].values, grid_lat)
    assert np.allclose(value["lon"].values, grid_lon)
    # 300 K -> 26.85 degC in the valid rows; south of 60S: NaN.
    assert value.values[66, 192] == pytest.approx(26.85)
    assert np.isnan(value.values[170, 0])
    # The fill cell (GLDAS lat 89.5 = contract row 0 after the flip) is NaN.
    assert np.isnan(value.values[0, 0])
