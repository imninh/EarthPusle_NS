"""P03 tests: grid driver contract shape/layers (case 10) and run-level IO."""

from __future__ import annotations

import numpy as np
import pytest
import xarray as xr

from earthpulse.contract import (
    CLASS_LAYERS,
    CORRELATION_LAYERS,
    FLOAT_LAYERS,
    INSUFFICIENT_DATA,
    N_COLS,
    N_MONTHS,
    N_ROWS,
    OUTSIDE_DOMAIN,
    TREND_INCREASE,
)
from earthpulse.stats.run import run_correlations, run_trends
from earthpulse.stats.trend import trend_grid

N = 288
T_YEARS = np.arange(N, dtype=float) / 12.0


def small_full_grid_mask(rng: np.random.Generator, n_cells: int = 30) -> np.ndarray:
    mask = np.zeros((N_ROWS, N_COLS), dtype=bool)
    rows = rng.integers(20, 160, size=n_cells)
    cols = rng.integers(10, 350, size=n_cells)
    mask[rows, cols] = True
    return mask


def test_case10_grid_driver_contract_shape_and_layers():
    """Output arrays (180, 360); NaN / -99 outside mask; layer names == contract."""
    rng = np.random.default_rng(1010)
    mask = small_full_grid_mask(rng, n_cells=30)
    cube = rng.normal(0.0, 0.1, size=(N, N_ROWS, N_COLS))
    cube[:, ~mask] = np.nan

    layers, extras = trend_grid(cube, mask, T_YEARS)

    assert set(layers) == set(FLOAT_LAYERS) | set(CLASS_LAYERS)
    for name, arr in layers.items():
        assert arr.shape == (N_ROWS, N_COLS), name
    outside = ~mask
    for name in FLOAT_LAYERS:
        assert np.isnan(layers[name][outside]).all(), name
    assert (layers["trend_class"][outside] == OUTSIDE_DOMAIN).all()
    # inside cells were evaluated (coverage 100%) -> finite stats, class set
    assert np.isfinite(layers["sen_slope"][mask]).all()
    assert np.isfinite(layers["q_value"][mask]).all()
    assert set(layers["trend_class"][mask]).issubset(
        {TREND_INCREASE, -1, 0, INSUFFICIENT_DATA}
    )
    assert extras["sen_intercept"].shape == (N_ROWS, N_COLS)


def test_case10_insufficient_cell_inside_mask():
    rng = np.random.default_rng(1011)
    mask = small_full_grid_mask(rng, n_cells=2)
    cube = np.full((N, N_ROWS, N_COLS), np.nan)
    # one healthy cell, one with only 20 valid months (< 80% of 288)
    r0, c0 = np.nonzero(mask)
    cube[:, r0[0], c0[0]] = rng.normal(0.0, 0.1, size=N)
    series = rng.normal(0.0, 0.1, size=N)
    series[np.random.default_rng(1).random(N) < 0.93] = np.nan
    cube[:, r0[1], c0[1]] = series

    layers, _ = trend_grid(cube, mask, T_YEARS)
    healthy = (r0[0], c0[0])
    poor = (r0[1], c0[1])
    assert layers["trend_class"][poor] == INSUFFICIENT_DATA
    assert np.isnan(layers["sen_slope"][poor])
    assert layers["trend_class"][healthy] != OUTSIDE_DOMAIN


def test_window_shorter_than_min_years_is_insufficient():
    """A 9-year window (108 months) fails MIN_YEARS -> INSUFFICIENT_DATA."""
    rng = np.random.default_rng(1012)
    mask = np.array([[True]])
    cube = rng.normal(0.0, 0.1, size=(108, 1, 1))
    layers, _ = trend_grid(cube, mask)
    assert layers["trend_class"][0, 0] == INSUFFICIENT_DATA
    assert layers["coverage"][0, 0] == 1.0  # n_valid/coverage still filled


def _write_mini_anomaly_netcdf(path, variable_id: str, values: np.ndarray, first_month: str):
    import pandas as pd

    ds = xr.Dataset(
        {"anomaly": (("time", "lat", "lon"), values)},
        coords={"time": pd.period_range(first_month, periods=values.shape[0], freq="M").to_timestamp()},
    )
    ds.attrs = {"synthetic": 1, "variable_id": variable_id}
    ds.to_netcdf(path, engine="netcdf4")


def test_run_trends_end_to_end(tmp_path):
    """run_trends: reads a P02-shaped file, writes every contract layer with attrs."""
    rng = np.random.default_rng(1013)
    mask = np.zeros((6, 8), dtype=bool)
    mask[2:4, 3:6] = True
    import pandas as pd

    labels = [f"{p.year:04d}-{p.month:02d}" for p in pd.period_range("2001-01", "2010-12", freq="M")]
    n_time = len(labels)
    values = rng.normal(0.0, 0.1, size=(n_time, 6, 8)).astype(np.float32)
    values[:, ~mask] = np.nan
    # add a strong positive trend in one cell
    values[:, 2, 3] += np.linspace(0.0, 1.0, n_time)

    anomaly_file = tmp_path / "anomalies" / "demo_var.nc"
    anomaly_file.parent.mkdir()
    _write_mini_anomaly_netcdf(anomaly_file, "demo_var", values, labels[0])
    mask_file = tmp_path / "anomalies" / "common_mask.nc"
    xr.Dataset({"common_mask": (("lat", "lon"), mask)}).to_netcdf(mask_file, engine="netcdf4")

    out = run_trends(
        "demo_var",
        "2001-2012",
        anomaly_dir=anomaly_file.parent,
        mask_file=mask_file,
        out_dir=tmp_path / "trends",
        synthetic=True,
    )
    assert out.exists()
    ds = xr.open_dataset(out, engine="netcdf4")
    try:
        assert set(ds.data_vars) == set(FLOAT_LAYERS) | set(CLASS_LAYERS)
        for name in ds.data_vars:
            assert "units" in ds[name].attrs and "description" in ds[name].attrs
        assert ds["trend_class"].dtype == np.int8
        tc = ds["trend_class"].values
        assert tc[2, 3] == TREND_INCREASE  # strong synthetic trend cell
        assert (tc[~mask] == OUTSIDE_DOMAIN).all()
        assert ds.attrs["variable_id"] == "demo_var"
        assert ds.attrs["synthetic"] == 1
    finally:
        ds.close()


def test_run_correlations_end_to_end(tmp_path):
    import pandas as pd

    rng = np.random.default_rng(1014)
    mask = np.zeros((4, 4), dtype=bool)
    mask[1:3, 1:3] = True
    labels = [f"{p.year:04d}-{p.month:02d}" for p in pd.period_range("2013-01", "2024-12", freq="M")]
    n_time = len(labels)
    shared = np.linspace(0.0, 0.5, n_time)[:, None, None]
    a = (shared + rng.normal(0.0, 0.05, size=(n_time, 4, 4))).astype(np.float32)
    b = (shared + rng.normal(0.0, 0.05, size=(n_time, 4, 4))).astype(np.float32)
    for arr in (a, b):
        arr[:, ~mask] = np.nan

    adir = tmp_path / "anomalies"
    adir.mkdir()
    _write_mini_anomaly_netcdf(adir / "var_a.nc", "var_a", a, labels[0])
    _write_mini_anomaly_netcdf(adir / "var_b.nc", "var_b", b, labels[0])
    mask_file = adir / "common_mask.nc"
    xr.Dataset({"common_mask": (("lat", "lon"), mask)}).to_netcdf(mask_file, engine="netcdf4")

    out = run_correlations(
        "var_a__var_b",
        "2013-2024",
        anomaly_dir=adir,
        mask_file=mask_file,
        out_dir=tmp_path / "correlations",
        synthetic=True,
    )
    assert out.exists()
    ds = xr.open_dataset(out, engine="netcdf4")
    try:
        assert set(ds.data_vars) == set(CORRELATION_LAYERS)
        assert ds["n_pairs"].dtype == np.float32
        assert np.isfinite(ds["r"].values[mask]).all()
        assert ds.attrs["pair_id"] == "var_a__var_b"
        assert ds.attrs["synthetic"] == 1
    finally:
        ds.close()


def test_parse_pair_rejects_non_alphabetical():
    from earthpulse.stats.run import parse_pair

    assert parse_pair("a__b") == ("a", "b")
    with pytest.raises(ValueError):
        parse_pair("b__a")
    with pytest.raises(ValueError):
        parse_pair("a_b_c")
