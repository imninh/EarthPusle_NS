"""P02 tests for earthpulse.anomalies (synthetic data only, no network)."""

from __future__ import annotations

import numpy as np
import pytest
import xarray as xr

from earthpulse import contract
from earthpulse.anomalies import (
    MIN_BASELINE_YEARS,
    compute_anomalies,
    compute_climatology,
    write_anomalies,
)


def monthly_time(start_year: int, n_years: int) -> xr.DataArray:
    """Monthly datetime64 coordinates starting January of ``start_year``."""
    start = np.datetime64(f"{start_year:04d}-01", "M")
    return xr.DataArray(start + np.arange(n_years * 12))


def seasonal_cube(n_years: int = 24, n_lat: int = 2, n_lon: int = 3,
                  trend_per_year: float = 0.0, start_year: int = 2001):
    """Synthetic (time, lat, lon) cube: seasonal cycle + optional linear trend."""
    time = monthly_time(start_year, n_years)
    months = time.dt.month.values
    years = time.dt.year.values - start_year
    seasonal = 10.0 * np.sin(2.0 * np.pi * months / 12.0)
    trend = trend_per_year * years
    values = (
        seasonal[:, None, None]
        + trend[:, None, None]
        + 100.0
    )
    values = np.broadcast_to(values, (n_years * 12, n_lat, n_lon)).copy()
    return xr.DataArray(
        values,
        dims=("time", "lat", "lon"),
        coords={"time": time.values, "lat": np.arange(n_lat), "lon": np.arange(n_lon)},
    )


# ---------------------------------------------------------------------------
# Climatology
# ---------------------------------------------------------------------------


def test_climatology_of_pure_seasonal_cycle():
    da = seasonal_cube()
    clim = compute_climatology(da)
    assert clim.dims == ("month", "lat", "lon")
    assert clim.sizes["month"] == 12
    # Every January of the baseline has the same value, so the January
    # climatology equals it exactly.
    january_value = float(da.isel(time=0).values[0, 0])
    assert float(clim.sel(month=1).values[0, 0]) == pytest.approx(january_value)
    assert np.isfinite(clim.values).all()


def test_climatology_nan_with_too_few_baseline_years():
    """A cell-month with fewer than 15 of 20 baseline years gets NaN."""
    da = seasonal_cube()
    # Drop 10 of the 20 baseline Januaries at cell (0, 0) -> 10 valid years.
    time = da["time"].values
    baseline_jans = [i for i in range(240) if time[i].astype("datetime64[M]").astype(int) % 12 == 0]
    drop = baseline_jans[::2]  # 10 of the 20 baseline Januaries
    da.values[np.ix_(drop, [0], [0])] = np.nan

    clim = compute_climatology(da)
    assert np.isnan(clim.sel(month=1).values[0, 0])
    # Other months at that cell are untouched.
    assert np.isfinite(clim.sel(month=2).values[0, 0])
    # Other cells keep a full January climatology.
    assert np.isfinite(clim.sel(month=1).values[1, 1])


def test_min_baseline_years_is_15():
    assert MIN_BASELINE_YEARS == 15


# ---------------------------------------------------------------------------
# Anomalies
# ---------------------------------------------------------------------------


def test_anomalies_of_pure_seasonal_cycle_are_zero():
    da = seasonal_cube()
    anomaly, clim = compute_anomalies(da)
    assert anomaly.shape == da.shape
    assert np.nanmax(np.abs(anomaly.values)) < 1e-9


def test_anomaly_keeps_linear_trend():
    """Seasonal cycle + 0.1/year trend: the anomaly isolates the trend."""
    trend = 0.1
    da = seasonal_cube(trend_per_year=trend)
    anomaly, _ = compute_anomalies(da)
    series = anomaly.values[:, 0, 0]
    # Regress the anomaly on time in years; the slope must match the trend.
    years = np.arange(series.size) / 12.0
    slope = np.polyfit(years, series, 1)[0]
    assert slope == pytest.approx(trend, rel=0.05)
    # The seasonal cycle is removed exactly: the anomaly is the trend minus
    # the baseline mean of the trend (a staircase constant within each year).
    expected = trend * (np.arange(series.size) // 12) - trend * np.mean(
        np.arange(20)
    )
    np.testing.assert_allclose(series, expected, atol=1e-9)


def test_anomaly_equals_value_minus_climatology():
    da = seasonal_cube()
    anomaly, clim = compute_anomalies(da)
    time = da["time"].values
    i = 125  # arbitrary month
    cal_month = int(str(time[i])[5:7])
    expected = da.values[i, 1, 2] - float(clim.sel(month=cal_month).values[1, 2])
    assert float(anomaly.values[i, 1, 2]) == pytest.approx(expected)


def test_anomaly_nan_where_climatology_nan():
    da = seasonal_cube()
    time = da["time"].values
    baseline_jans = [i for i in range(240) if time[i].astype("datetime64[M]").astype(int) % 12 == 0]
    drop = baseline_jans[::2]
    da.values[np.ix_(drop, [0], [0])] = np.nan
    anomaly, _ = compute_anomalies(da)
    # All Januaries at that cell are NaN (climatology missing); the
    # post-baseline January 2021 too.
    jan_index = 12 * 20  # 2021-01
    assert np.isnan(anomaly.values[jan_index, 0, 0])
    assert np.isfinite(anomaly.values[jan_index + 1, 0, 0])  # 2021-02 fine


def test_baseline_outside_series_raises():
    """A cube without baseline months cannot produce a climatology."""
    da = seasonal_cube(start_year=2021)  # no 2001-2020 months
    with pytest.raises(ValueError, match="baseline"):
        compute_climatology(da)


# ---------------------------------------------------------------------------
# File output
# ---------------------------------------------------------------------------


def test_write_anomalies_file_structure(tmp_path):
    cube_path = tmp_path / "cube.nc"
    out_path = tmp_path / "anom.nc"
    da = seasonal_cube(n_lat=2, n_lon=3)
    cube = xr.Dataset(
        {"root_zone_soil_moisture": da},
        attrs={"units": "kg m-2", "source_product": "GLDAS_NOAH10_M",
               "source_variable": "RootMoist_inst"},
    )
    cube.to_netcdf(cube_path)

    written = write_anomalies(cube_path, out_path, "root_zone_soil_moisture")
    assert written == out_path
    with xr.open_dataset(out_path) as ds:
        assert set(ds.data_vars) == {"anomaly", "climatology"}
        assert ds["anomaly"].dims == ("time", "lat", "lon")
        assert ds["climatology"].dims == ("month", "lat", "lon")
        assert list(ds["climatology"]["month"].values) == list(range(1, 13))
        assert ds["anomaly"].dtype == np.float64  # README §5 decision 3
        assert ds["climatology"].dtype == np.float32
        assert ds.attrs["baseline"] == (
            f"{contract.BASELINE[0]}..{contract.BASELINE[1]}"
        )
        assert ds.attrs["units"] == "kg m-2"
        assert ds.attrs["min_baseline_years"] == 15
        assert "no percentage anomalies" in ds.attrs["anomaly_definition"]
        # Values agree with the in-memory computation.
        anomaly, clim = compute_anomalies(da)
        np.testing.assert_allclose(
            ds["anomaly"].values, anomaly.values.astype(np.float64)
        )
        np.testing.assert_allclose(
            ds["climatology"].values, clim.values.astype(np.float32)
        )
