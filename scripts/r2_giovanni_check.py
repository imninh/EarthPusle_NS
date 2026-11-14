#!/usr/bin/env python
"""C1 (R2): compare the EarthPulse Vietnam air-temperature series with Giovanni.

The input is the CSV downloaded from NASA Giovanni (area-averaged GLDAS
NOAH10_M 2.1 ``Tair_f_inst``, 2001-01..2024-12). The bounding box, variable
and reference period are read from the CSV header; nothing is assumed about
the box.

Our side is the cos(latitude)-weighted monthly mean of the harmonized
``air_temperature`` cube over the same box (the ``Data Bounding Box`` line in
the Giovanni header, which is the box Giovanni actually averaged).

Run from the repo root:
    .venv/Scripts/python scripts/r2_giovanni_check.py
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from earthpulse.anomalies import compute_anomalies  # noqa: E402
from earthpulse.stats.trend import analyse_series  # noqa: E402

VARIABLE_ID = "air_temperature"
CUBE_PATH = PROJECT_ROOT / "data" / "interim" / "harmonized_monthly" / f"{VARIABLE_ID}.nc"
# The task path is data/raw/giovanni; the downloaded file on this machine is in
# the misspelled sibling data/raw/giovani. Both are searched, no file is moved.
CSV_DIRS = (
    PROJECT_ROOT / "data" / "raw" / "giovanni",
    PROJECT_ROOT / "data" / "raw" / "giovani",
)


def _meta_lookup(meta: dict[str, str], name: str) -> str | None:
    wanted = name.strip().lower()
    for key, value in meta.items():
        if key.strip().lower() == wanted:
            return value.strip()
    return None


def _find_fill_value(meta: dict[str, str]) -> float | None:
    for key, value in meta.items():
        if key.strip().lower().startswith("fill value"):
            try:
                return float(value.strip())
            except ValueError:
                return None
    return None


def _parse_bbox(text: str, label: str) -> tuple[float, float, float, float]:
    parts = [part.strip() for part in text.split(",")]
    if len(parts) != 4:
        raise ValueError(f"{label} is not four numbers: {text!r}")
    west, south, east, north = (float(part) for part in parts)
    if not (west < east and south < north):
        raise ValueError(f"{label} is not west,south,east,north: {text!r}")
    return west, south, east, north


def parse_giovanni_csv(path: Path) -> dict:
    """Read Giovanni's metadata block and data table without assuming its layout."""
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    meta: dict[str, str] = {}
    header: list[str] | None = None
    header_line = -1
    for number, line in enumerate(lines):
        if not line.strip():
            continue
        row = next(csv.reader([line]))
        if len(row) >= 2 and row[0].strip().endswith(":"):
            meta[row[0].strip().rstrip(":")] = row[1]
        elif row and row[0].strip().lower() == "time":
            header = [cell.strip() for cell in row]
            header_line = number
            break
    if header is None or header_line < 0:
        raise ValueError(f"{path}: no 'time' header row found")
    if len(header) < 2 or not header[1]:
        raise ValueError(f"{path}: no value column after the time column")

    data_rows = []
    for row in csv.reader(lines[header_line + 1 :]):
        if len(row) < 2 or not row[0].strip():
            continue
        data_rows.append((row[0].strip(), row[1].strip()))
    if not data_rows:
        raise ValueError(f"{path}: no data rows after the header")

    times = pd.to_datetime([row[0] for row in data_rows], errors="raise")
    values = pd.to_numeric(pd.Series([row[1] for row in data_rows]), errors="coerce")
    series = pd.Series(values.to_numpy(dtype=float), index=times, name=header[1])
    if series.index.has_duplicates:
        raise ValueError(f"{path}: duplicate timestamps")
    series = series.sort_index()

    user_box = _meta_lookup(meta, "User Bounding Box")
    data_box = _meta_lookup(meta, "Data Bounding Box")
    box_text = data_box or user_box
    if box_text is None:
        raise ValueError(f"{path}: no User/Data Bounding Box in the header")
    box = _parse_bbox(box_text, "Data Bounding Box" if data_box else "User Bounding Box")

    unit_keys = [key for key in meta if "unit" in key.lower()]
    units = meta[unit_keys[0]].strip() if unit_keys else None
    fill = _find_fill_value(meta)
    return {
        "path": path,
        "meta": meta,
        "title": _meta_lookup(meta, "Title"),
        "start": _meta_lookup(meta, "User Start Date"),
        "end": _meta_lookup(meta, "User End Date"),
        "user_box": _parse_bbox(user_box, "User Bounding Box") if user_box else None,
        "data_box": box,
        "box_label": "Data Bounding Box" if data_box else "User Bounding Box",
        "units": units,
        "fill": fill,
        "column": header[1],
        "series": series,
    }


def _find_csv() -> Path:
    found: list[Path] = []
    for directory in CSV_DIRS:
        if directory.is_dir():
            found.extend(sorted(directory.glob("*.csv")))
    if not found:
        raise FileNotFoundError(
            "Giovanni CSV not found in "
            + " or ".join(str(path) for path in CSV_DIRS)
        )
    if len(found) > 1:
        raise RuntimeError(
            "more than one Giovanni CSV found; pass one explicitly with --csv: "
            + ", ".join(str(path) for path in found)
        )
    return found[0]


def _celsius(series: pd.Series, header_units: str | None, cube_attrs: dict) -> tuple[pd.Series, str]:
    """Convert the Giovanni series to the cube's display unit, stating the rule."""
    cube_units = str(cube_attrs.get("units", "")).strip()
    conversion = str(cube_attrs.get("conversion", "")).strip()
    if cube_units not in {"degC", "°C", "C"}:
        raise ValueError(f"unexpected EarthPulse cube units: {cube_units!r}")

    unit = (header_units or "").strip().lower().replace("°", "")
    if unit in {"k", "kelvin", "kelvins", "degk", "degrees_kelvin"}:
        return series - 273.15, "CSV header unit K: subtracted 273.15"
    if unit in {"c", "celsius", "degc", "degrees_celsius"}:
        return series, "CSV header unit degC: no conversion"
    if conversion == "kelvin_to_celsius":
        return (
            series - 273.15,
            "CSV header has no unit line; EarthPulse cube records "
            "kelvin_to_celsius (native K -> degC), so subtracted 273.15",
        )
    if conversion == "identity":
        return series, "CSV header has no unit line; EarthPulse cube records identity"
    raise ValueError(
        f"cannot reconcile CSV units {header_units!r} with cube conversion {conversion!r}"
    )


def _our_box_mean(
    cube: xr.DataArray, box: tuple[float, float, float, float]
) -> tuple[pd.Series, int, int, int]:
    west, south, east, north = box
    sub = cube.sel(lat=slice(north, south), lon=slice(west, east))
    if sub.sizes.get("lat", 0) == 0 or sub.sizes.get("lon", 0) == 0:
        raise ValueError(f"the box {box} selects no cells from the harmonized cube")
    values = np.asarray(sub.values, dtype=float)
    weights = np.cos(np.deg2rad(np.asarray(sub["lat"].values, dtype=float)))
    weights_2d = np.broadcast_to(weights[:, None], values.shape[1:])
    finite = np.isfinite(values)
    numerator = np.nansum(values * weights_2d[None, :, :], axis=(1, 2))
    denominator = np.nansum(np.where(finite, weights_2d[None, :, :], 0.0), axis=(1, 2))
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.where(denominator > 0, numerator / denominator, np.nan)
    series = pd.Series(mean, index=pd.to_datetime(sub["time"].values), name="EarthPulse")
    valid_cells = finite.sum(axis=(1, 2))
    return (
        series,
        int(valid_cells.min()),
        int(valid_cells.max()),
        int(values.shape[1] * values.shape[2]),
    )


def _analyse(series: pd.Series, common: pd.DatetimeIndex) -> tuple[float, float | None]:
    """Sen slope per decade of 2001-2020-baseline anomalies on common months."""
    da = xr.DataArray(
        series.to_numpy(dtype=float),
        dims="time",
        coords={"time": series.index},
        name="air_temperature",
    )
    anomaly, _ = compute_anomalies(da)
    anomaly_common = pd.Series(
        np.asarray(anomaly.values, dtype=float), index=series.index
    ).loc[common]
    t_years = (
        (common.year - common[0].year)
        + (common.month - common[0].month) / 12.0
    ).to_numpy(dtype=float)
    result = analyse_series(anomaly_common.to_numpy(dtype=float), t_years)
    slope = float(result["sen_slope_decade"])
    p_value = float(result["p_value"]) if np.isfinite(result["p_value"]) else None
    return slope, p_value


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=None, help="Giovanni CSV (default: find one)")
    args = parser.parse_args()

    try:
        csv_path = args.csv if args.csv is not None else _find_csv()
        if not csv_path.is_file():
            raise FileNotFoundError(f"Giovanni CSV not found: {csv_path}")
        parsed = parse_giovanni_csv(csv_path)
        if not CUBE_PATH.is_file():
            raise FileNotFoundError(f"harmonized cube not found: {CUBE_PATH}")

        with xr.open_dataset(CUBE_PATH, engine="netcdf4") as ds:
            cube = ds[VARIABLE_ID].load()
            cube_attrs = dict(ds.attrs)
        source_variable = str(cube_attrs.get("source_variable", ""))
        column = parsed["column"].lower()
        title = (parsed["title"] or "").lower()
        if source_variable and source_variable.lower() not in column + " " + title:
            raise ValueError(
                f"CSV does not name the EarthPulse source variable {source_variable!r}: "
                f"column={parsed['column']!r}, title={parsed['title']!r}"
            )

        raw = parsed["series"]
        fill = parsed["fill"]
        if fill is not None:
            raw = raw.mask(raw == fill)
        raw = raw.dropna()
        giovanni, conversion_note = _celsius(raw, parsed["units"], cube_attrs)

        ours, valid_min, valid_max, box_cells = _our_box_mean(cube, parsed["data_box"])
        common = giovanni.index.intersection(ours.dropna().index)
        if len(common) == 0:
            raise ValueError("the Giovanni series and the EarthPulse series share no months")
        g = giovanni.loc[common]
        o = ours.loc[common]
        difference = g - o
        r = float(np.corrcoef(g.to_numpy(), o.to_numpy())[0, 1]) if len(common) > 1 else float("nan")
        mean_difference = float(difference.mean())
        rms_difference = float(np.sqrt(np.mean(np.square(difference.to_numpy()))))
        g_slope, g_p = _analyse(giovanni, common)
        o_slope, o_p = _analyse(ours, common)

        print(f"CSV: {csv_path}")
        print(f"title: {parsed['title']}")
        print(f"variable column: {parsed['column']}")
        print(f"declared start/end: {parsed['start']} .. {parsed['end']}")
        print(f"header box ({parsed['box_label']}): {parsed['data_box']}")
        if parsed["user_box"] is not None:
            print(f"header User Bounding Box: {parsed['user_box']}")
        print(f"header units: {parsed['units'] or 'none stated'}")
        print(f"unit handling: {conversion_note}")
        print(
            f"EarthPulse box: {parsed['data_box']} "
            f"(valid land cells {valid_min}..{valid_max} of {box_cells})"
        )
        print(f"Giovanni months: {len(giovanni)}; EarthPulse months: {len(ours.dropna())}")
        print(f"common months: {len(common)} ({common[0]:%Y-%m} .. {common[-1]:%Y-%m})")
        print(f"Pearson r: {r:.15g}")
        print(f"mean difference (Giovanni - EarthPulse): {mean_difference:.15g} degC")
        print(f"RMS difference: {rms_difference:.15g} degC")
        print(f"Sen slope, Giovanni anomalies: {g_slope:.15g} degC/decade (p={g_p})")
        print(f"Sen slope, EarthPulse anomalies: {o_slope:.15g} degC/decade (p={o_p})")
        print(f"Sen slope difference (Giovanni - EarthPulse): {g_slope - o_slope:.15g} degC/decade")
        print("NOTE: Giovanni's box average includes every cell its product returns in the box;")
        print("      the EarthPulse mean uses only finite (land-masked) harmonized cells.")
        return 0
    except (FileNotFoundError, ValueError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
