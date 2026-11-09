"""P08 T1 tests for the permanent-snow/ice mask (synthetic data only)."""

from __future__ import annotations

import numpy as np
import xarray as xr

from earthpulse import contract
from earthpulse.harmonize import (
    PERMANENT_SNOW_MIN_SWE,
    build_common_mask,
    swe_exclusion_mask,
)
from earthpulse.grid import target_grid


def test_swe_exclusion_threshold_and_nan() -> None:
    values = np.full((contract.N_ROWS, contract.N_COLS), np.nan)
    values[0, 0] = 5.0
    values[0, 1] = 10.0
    values[0, 2] = 10.1
    values[0, 3] = np.inf

    excluded = swe_exclusion_mask(values)
    assert excluded.shape == values.shape
    assert not excluded[0, 0]
    assert not excluded[0, 1]  # strictly greater than the threshold
    assert excluded[0, 2]
    assert not excluded[0, 3]  # non-finite is handled by the coverage criterion

    assert swe_exclusion_mask(values, threshold=4.0)[0, 0]
    assert swe_exclusion_mask(values, threshold=4.0)[0, 1]


def _write_cube(path, name, values) -> None:
    lat, lon = target_grid()
    time = np.arange(contract.N_MONTHS)
    ds = xr.Dataset(
        {
            name: xr.DataArray(
                values,
                dims=("time", "lat", "lon"),
                coords={"time": time, "lat": lat, "lon": lon},
            )
        }
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    ds.to_netcdf(path, engine="netcdf4")
    ds.close()


def test_build_common_mask_removes_permanent_snow(tmp_path) -> None:
    interim = tmp_path / "interim"
    interim.mkdir()
    mask = np.zeros((contract.N_ROWS, contract.N_COLS), dtype=bool)
    mask[10:13, 20:23] = True  # 3 x 3 synthetic land patch

    for variable_id in ("core_a", "core_b"):
        values = np.full((contract.N_MONTHS, contract.N_ROWS, contract.N_COLS), np.nan)
        values[:, mask] = 1.0
        _write_cube(interim / f"{variable_id}.nc", variable_id, values)

    precip = np.full((contract.N_MONTHS, contract.N_ROWS, contract.N_COLS), np.nan)
    precip[:, mask] = 1.0
    _write_cube(interim / "precipitation.nc", "valid_fraction", precip)

    swe = np.full((contract.N_ROWS, contract.N_COLS), np.nan)
    swe[mask] = 0.0
    swe[10, 20] = PERMANENT_SNOW_MIN_SWE + 1.0  # one permanent-ice cell
    lat, lon = target_grid()
    cache = xr.Dataset(
        {
            "swe_min": xr.DataArray(
                swe.astype(np.float32),
                dims=("lat", "lon"),
                coords={"lat": lat, "lon": lon},
            )
        }
    )
    cache.to_netcdf(interim / "swe_min.nc", engine="netcdf4")
    cache.close()

    registry = {
        "variables": [
            {"id": "core_a", "product": "GLDAS_NOAH10_M", "core": True},
            {"id": "core_b", "product": "GLDAS_NOAH10_M", "core": True},
            {"id": "precipitation", "product": "GPM_3IMERG", "core": True},
        ]
    }
    out = interim / "common_mask.nc"
    result = build_common_mask(registry, interim, out)

    inside = result["common_mask"].values.astype(bool)
    assert int(inside.sum()) == 8
    assert not inside[10, 20]
    assert "swe_min" in result
    assert result.attrs["n_cells_removed_by_swe"] == 1
    assert result.attrs["n_cells_before_swe"] == 9
    assert result.attrs["swe_min_threshold_kg_m2"] == PERMANENT_SNOW_MIN_SWE
    assert "minimum monthly SWE" in result.attrs["criteria"]
    result.close()

    with xr.open_dataset(out, engine="netcdf4") as written:
        assert int(written["common_mask"].sum()) == 8
        assert "swe_min" in written
        assert written.attrs["n_cells_removed_by_swe"] == 1
