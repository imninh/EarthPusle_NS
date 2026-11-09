"""P02 T5: baseline climatology and monthly anomalies.

For every cell and calendar month, the climatology is the mean of the
baseline years (contract: 2001-01 .. 2020-12, i.e. 20 years), requiring at
least ``MIN_BASELINE_YEARS`` (15) of those 20 years valid; otherwise the
climatology is NaN for that cell-month and so is every anomaly of it.

``anomaly = value − climatology[calendar_month]``.

Precipitation keeps the **absolute** anomaly only — no percentage anomalies
in v1 (P02 spec T5). All functions are grid-size agnostic and operate on
``(time, lat, lon)`` DataArrays, so tests can use small synthetic grids.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import xarray as xr

from earthpulse import contract

# Of the 20 baseline years, at least this many must be valid for a cell-month
# climatology to exist (P02 spec T5).
MIN_BASELINE_YEARS = 15


def compute_climatology(da: xr.DataArray) -> xr.DataArray:
    """Baseline per-cell, per-calendar-month climatology.

    Parameters
    ----------
    da:
        ``(time, lat, lon)`` monthly values with a datetime-like time
        coordinate covering the contract baseline.

    Returns
    -------
    ``(month, lat, lon)`` DataArray, ``month`` = calendar month 1..12;
    NaN where fewer than ``MIN_BASELINE_YEARS`` baseline years are valid.
    """
    baseline = da.sel(time=slice(contract.BASELINE[0], contract.BASELINE[1]))
    if baseline.sizes.get("time", 0) == 0:
        raise ValueError(
            f"No months inside the baseline {contract.BASELINE[0]}.."
            f"{contract.BASELINE[1]} found in the time coordinate."
        )
    parts = []
    for month in range(1, 13):
        sub = baseline.isel(time=(baseline["time"].dt.month == month).values)
        count = sub.notnull().sum("time")
        mean = sub.mean("time", skipna=True)
        parts.append(mean.where(count >= MIN_BASELINE_YEARS))
    climatology = xr.concat(parts, dim="month")
    climatology = climatology.assign_coords(month=np.arange(1, 13, dtype=np.int8))
    climatology.attrs.update(da.attrs)
    climatology.attrs["baseline"] = (
        f"{contract.BASELINE[0]}..{contract.BASELINE[1]}"
    )
    climatology.attrs["min_baseline_years"] = MIN_BASELINE_YEARS
    return climatology


def compute_anomalies(da: xr.DataArray) -> tuple[xr.DataArray, xr.DataArray]:
    """Return ``(anomaly, climatology)`` for a monthly cube.

    ``anomaly`` has the same dims as ``da``; NaN wherever the value or the
    cell-month climatology is missing.
    """
    climatology = compute_climatology(da)
    month_index = da["time"].dt.month - 1
    anomaly = da - climatology.isel(month=month_index)
    anomaly.attrs.update(da.attrs)
    anomaly.attrs.pop("baseline", None)
    anomaly.attrs["anomaly_definition"] = "value - baseline climatology (calendar month)"
    return anomaly, climatology


def write_anomalies(cube_path: Path, out_path: Path, variable_id: str) -> Path:
    """Compute and write ``data/processed/anomalies/{variable_id}.nc``.

    The output holds ``anomaly`` ``(time, lat, lon)`` and ``climatology``
    ``(month, lat, lon)``. ``anomaly`` is stored **float64** (architect
    decision, README §5.3: avoid quantization ties in Mann–Kendall);
    ``climatology`` is float32 (derived display data).

    Provenance attributes are copied from the harmonized cube.
    """
    with xr.open_dataset(cube_path) as cube:
        values = cube[variable_id].load()
        source_attrs = dict(cube.attrs)
    anomaly, climatology = compute_anomalies(values)

    dataset = xr.Dataset(
        {
            "anomaly": anomaly.astype(np.float64),
            "climatology": climatology.astype(np.float32),
        },
        attrs={
            "title": f"EarthPulse monthly anomalies: {variable_id}",
            "units": source_attrs.get("units"),
            "source_product": source_attrs.get("source_product"),
            "source_variable": source_attrs.get("source_variable"),
            "source_cube": Path(cube_path).name,
            "baseline": f"{contract.BASELINE[0]}..{contract.BASELINE[1]}",
            "min_baseline_years": MIN_BASELINE_YEARS,
            "anomaly_definition": "absolute anomaly (value - climatology); "
            "no percentage anomalies in v1",
            "anomaly_dtype_note": "float64 to avoid quantization ties in "
            "Mann-Kendall (README §5 decision 3)",
            "package": "P02",
        },
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    encoding = {
        "anomaly": {"dtype": "float64", "zlib": True, "complevel": 4},
        "climatology": {"dtype": "float32", "zlib": True, "complevel": 4},
    }
    dataset.to_netcdf(out_path, engine="netcdf4", encoding=encoding)
    return out_path
