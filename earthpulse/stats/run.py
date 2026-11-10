"""High-level P03 entry points: run trends and correlations, write contract NetCDFs.

Inputs (from P02): ``data/processed/anomalies/{variable_id}.nc`` (variable
``anomaly``, dims ``(time, lat, lon)``) and ``data/processed/anomalies/common_mask.nc``
(variable ``common_mask``, dims ``(lat, lon)``).

Outputs (DATA_CONTRACT section 7): ``data/processed/trends/{variable}/{window}.nc``
with every ``contract.FLOAT_LAYERS`` layer + ``trend_class``, and
``data/processed/correlations/{pair}/{window}.nc`` with every
``contract.CORRELATION_LAYERS`` layer.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import xarray as xr

from earthpulse.contract import (
    CLASS_LAYERS,
    CORRELATION_LAYERS,
    FLOAT_LAYERS,
    N_COLS,
    N_MONTHS,
    N_ROWS,
    SCHEMA_VERSION,
    WINDOWS,
    col_to_lon,
    row_to_lat,
)
from earthpulse.stats.association import correlation_grid
from earthpulse.stats.trend import trend_grid

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ANOMALY_DIR = PROJECT_ROOT / "data" / "processed" / "anomalies"
TRENDS_DIR = PROJECT_ROOT / "data" / "processed" / "trends"
CORRELATIONS_DIR = PROJECT_ROOT / "data" / "processed" / "correlations"

# Units / descriptions written as NetCDF variable attributes (acceptance: every
# contract layer present with units/description).
_FLOAT_LAYER_META = {
    "sen_slope": ("unit year-1 (variable display unit)", "Sen's slope of the anomaly series per year"),
    "sen_slope_decade": ("unit decade-1 (variable display unit)", "Sen's slope per decade (10 x sen_slope)"),
    "std_change_decade": ("1", "Sen slope per decade divided by the std of the residuals from the Sen line"),
    "p_value": ("1", "Hamed-Rao modified Mann-Kendall p-value (autocorrelation-aware; falls back to the unmodified p when the modified p is non-finite)"),
    "p_value_original": ("1", "Unmodified Mann-Kendall test p-value (comparison only)"),
    "q_value": ("1", "Benjamini-Hochberg FDR adjusted p-value over the evaluated cells"),
    "mk_tau": ("1", "Kendall tau of the Hamed-Rao modified Mann-Kendall test"),
    "n_valid": ("months", "Number of valid months in the window"),
    "coverage": ("1", "n_valid / number of months in the window"),
}
_CLASS_LAYER_META = {
    "trend_class": (
        "1",
        "1 increase, -1 decrease, 0 not significant, -9 insufficient data, -99 outside domain",
    ),
}
_CORR_LAYER_META = {
    "r": ("1", "Spearman rho of monthly anomalies (raw)"),
    "q": ("1", "BH-FDR adjusted p-value of the raw anomaly correlation"),
    "r_detrended": ("1", "Spearman rho of monthly anomalies after removing each series' Sen line"),
    "q_detrended": ("1", "BH-FDR adjusted p-value of the detrended anomaly correlation"),
    "n_pairs": ("months", "Number of paired valid months"),
}


def load_anomalies(
    variable_id: str, anomaly_dir: str | Path | None = None
) -> tuple[np.ndarray, list[str]]:
    """Load one P02 anomaly cube -> (data (time, lat, lon) float, month labels)."""
    path = Path(anomaly_dir or ANOMALY_DIR) / f"{variable_id}.nc"
    ds = xr.open_dataset(path, engine="netcdf4")
    try:
        da = ds["anomaly"]
        data = np.asarray(da.values, dtype=float)
        if "time" in da.coords and da.sizes.get("time", 0) > 0:
            idx = np.asarray(ds.indexes["time"])
            labels = [str(np.datetime_as_string(t, unit="M")) if np.issubdtype(np.asarray(t).dtype, np.datetime64) else str(t) for t in idx]
        else:
            labels = _default_month_labels(data.shape[0])
        return data, labels
    finally:
        ds.close()


def _resolve_mask_file(
    mask_file: str | Path | None, anomaly_dir: str | Path | None
) -> str | Path | None:
    """Default the mask to the anomaly dir when a custom anomaly dir is given."""
    if mask_file is not None:
        return mask_file
    if anomaly_dir is not None:
        return Path(anomaly_dir) / "common_mask.nc"
    return None


def load_common_mask(mask_file: str | Path | None = None) -> np.ndarray:
    """Load the P02 common land mask -> bool (lat, lon)."""
    path = Path(mask_file or ANOMALY_DIR / "common_mask.nc")
    ds = xr.open_dataset(path, engine="netcdf4")
    try:
        if "common_mask" in ds:
            da = ds["common_mask"]
        else:  # fall back to the first (only) boolean data variable
            (name,) = ds.data_vars
            da = ds[name]
        return np.asarray(da.values, dtype=bool)
    finally:
        ds.close()


def _default_month_labels(n: int) -> list[str]:
    if n != N_MONTHS:
        raise ValueError(
            f"anomaly cube has {n} months and no time coordinate; cannot label "
            f"(expected {N_MONTHS} contract months)"
        )
    import pandas as pd

    months = pd.period_range("2001-01", periods=N_MONTHS, freq="M")
    return [f"{p.year:04d}-{p.month:02d}" for p in months]


def window_slice(month_labels: list[str], window_id: str) -> tuple[np.ndarray, np.ndarray]:
    """Indices of the window's months + their time positions in years."""
    if window_id not in WINDOWS:
        raise KeyError(f"unknown window id {window_id!r}; known: {sorted(WINDOWS)}")
    start, end = WINDOWS[window_id]
    labels = np.asarray(month_labels)
    sel = np.nonzero((labels >= start) & (labels <= end))[0]
    if sel.size == 0:
        raise ValueError(f"window {window_id!r} not found in anomaly cube months")
    # windows are contiguous month ranges; positions in years from window start
    t_years = (sel - sel[0]).astype(float) / 12.0
    return sel, t_years


def _grid_dataset(layers: dict[str, np.ndarray], meta: dict[str, tuple[str, str]]) -> xr.Dataset:
    n_lat, n_lon = next(iter(layers.values())).shape
    if (n_lat, n_lon) == (N_ROWS, N_COLS):
        lat = np.array([row_to_lat(r) for r in range(N_ROWS)])
        lon = np.array([col_to_lon(c) for c in range(N_COLS)])
    else:
        # non-contract grids only occur in tests/small subsets; keep index coords
        lat = np.arange(n_lat, dtype=float)
        lon = np.arange(n_lon, dtype=float)
    data_vars = {}
    for name, arr in layers.items():
        units, desc = meta[name]
        data_vars[name] = xr.DataArray(
            arr, dims=("lat", "lon"),
            attrs={"units": units, "description": desc},
        )
    return xr.Dataset(
        data_vars,
        coords={"lat": ("lat", lat, {"units": "degrees_north", "description": "cell centre latitude"}),
                "lon": ("lon", lon, {"units": "degrees_east", "description": "cell centre longitude"})},
    )


def _write_grid(ds: xr.Dataset, out_path: Path, attrs: dict) -> Path:
    ds.attrs.update(attrs)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    encoding = {
        name: {"dtype": "int8" if name in CLASS_LAYERS else "float32", "zlib": True}
        for name in ds.data_vars
    }
    ds.to_netcdf(out_path, engine="netcdf4", encoding=encoding)
    return out_path


def compute_trend(
    variable_id: str,
    window_id: str,
    anomaly_dir: str | Path | None = None,
    mask_file: str | Path | None = None,
) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    """Compute (but do not write) the trend grids for one variable x window.

    Returns ``(layers, extras)`` from :func:`earthpulse.stats.trend.trend_grid`;
    the extras (``sen_intercept`` and the raw p-value map) feed the
    detrended-association step.
    """
    data, labels = load_anomalies(variable_id, anomaly_dir)
    mask = load_common_mask(_resolve_mask_file(mask_file, anomaly_dir))
    sel, t_years = window_slice(labels, window_id)
    if data.shape[1:] != mask.shape:
        raise ValueError(
            f"anomaly grid {data.shape[1:]} does not match mask {mask.shape}"
        )
    return trend_grid(data[sel, :, :], mask, t_years)


def run_trends(
    variable_id: str,
    window_id: str,
    anomaly_dir: str | Path | None = None,
    mask_file: str | Path | None = None,
    out_dir: str | Path | None = None,
    synthetic: bool = False,
    trend: tuple[dict, dict] | None = None,
) -> Path:
    """Per-cell trend statistics for one variable x window -> trends NetCDF.

    ``trend`` may pass a precomputed ``(layers, extras)`` result (e.g. from
    :func:`compute_trend`) to avoid recomputation.
    """
    layers, _extras = trend or compute_trend(variable_id, window_id, anomaly_dir, mask_file)
    ds = _grid_dataset(layers, {**_FLOAT_LAYER_META, **_CLASS_LAYER_META})
    return _write_grid(
        ds,
        Path(out_dir or TRENDS_DIR) / variable_id / f"{window_id}.nc",
        {
            "schema_version": SCHEMA_VERSION,
            "variable_id": variable_id,
            "window_id": window_id,
            "synthetic": int(synthetic),
            "method": (
                "Sen's slope (median pairwise slope at real time positions); "
                "Hamed-Rao modified Mann-Kendall (p_value) and unmodified "
                "Mann-Kendall (p_value_original) on valid months in time order; "
                "a non-finite Hamed-Rao p for an evaluated cell falls back to "
                "the unmodified Mann-Kendall p; BH-FDR (q_value) over evaluated "
                "cells, and trend_class uses q < 0.05 strictly; constants from "
                "earthpulse/contract.py"
            ),
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
    )


def parse_pair(pair_id: str) -> tuple[str, str]:
    """'a__b' (alphabetical) -> ('a', 'b')."""
    parts = pair_id.split("__")
    if len(parts) != 2:
        raise ValueError(f"bad pair id {pair_id!r}; expected 'var1__var2'")
    if parts[0] >= parts[1]:
        raise ValueError(f"pair id {pair_id!r} must be in alphabetical order")
    return parts[0], parts[1]


def run_correlations(
    pair_id: str,
    window_id: str,
    anomaly_dir: str | Path | None = None,
    mask_file: str | Path | None = None,
    out_dir: str | Path | None = None,
    synthetic: bool = False,
    trend_results: dict[str, tuple[dict, dict]] | None = None,
) -> Path:
    """Per-cell Spearman association for one pair x window -> correlations NetCDF.

    ``trend_results`` may cache ``{variable_id: (layers, extras)}`` from
    :func:`run_trends` internals to avoid recomputing the Sen fits; when
    omitted, the trend grids are computed here.
    """
    var_a, var_b = parse_pair(pair_id)
    cache = trend_results or {}

    def _trend(variable_id: str) -> tuple[dict, dict]:
        if variable_id not in cache:
            data, labels = load_anomalies(variable_id, anomaly_dir)
            mask = load_common_mask(_resolve_mask_file(mask_file, anomaly_dir))
            sel, t_years = window_slice(labels, window_id)
            cache[variable_id] = trend_grid(data[sel, :, :], mask, t_years)
        return cache[variable_id]

    mask = load_common_mask(_resolve_mask_file(mask_file, anomaly_dir))
    data_a, labels_a = load_anomalies(var_a, anomaly_dir)
    data_b, labels_b = load_anomalies(var_b, anomaly_dir)
    if labels_a != labels_b:
        raise ValueError(f"month labels differ between {var_a} and {var_b}")
    sel, t_years = window_slice(labels_a, window_id)

    layers_a, extras_a = _trend(var_a)
    layers_b, extras_b = _trend(var_b)
    sen_a = {"sen_slope": layers_a["sen_slope"], "sen_intercept": extras_a["sen_intercept"]}
    sen_b = {"sen_slope": layers_b["sen_slope"], "sen_intercept": extras_b["sen_intercept"]}

    layers = correlation_grid(
        data_a[sel, :, :], data_b[sel, :, :], mask, t_years, sen_a=sen_a, sen_b=sen_b
    )
    ds = _grid_dataset(layers, _CORR_LAYER_META)
    return _write_grid(
        ds,
        Path(out_dir or CORRELATIONS_DIR) / pair_id / f"{window_id}.nc",
        {
            "schema_version": SCHEMA_VERSION,
            "pair_id": pair_id,
            "window_id": window_id,
            "synthetic": int(synthetic),
            "method": (
                "Spearman rank correlation of monthly anomalies on paired valid "
                "months (>= 80% of the window), raw and after removing each "
                "series' Sen line; BH-FDR per map; constants from "
                "earthpulse/contract.py"
            ),
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
    )
