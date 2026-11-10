"""P06 driver: select Detective Cases from real P03/P08 outputs.

Writes ``cases.json`` (contract section 9) into an existing export folder.
The export step owns the rest of the tree; this script only replaces the
placeholder case file.

Examples:
    .venv/Scripts/python scripts/p06_cases.py
    .venv/Scripts/python scripts/p06_cases.py --export-dir data/export/web_data
    .venv/Scripts/python scripts/p06_cases.py --maps-dir "$TEMP/p06_maps"
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import xarray as xr
import yaml

from earthpulse import contract
from earthpulse.cases import (
    DEFAULT_CASES_CONFIG_PATH,
    DEFAULT_EXPORT_DIR,
    DEFAULT_MAX_CASES,
    DEFAULT_MIN_CLUSTER_CELLS,
    DEFAULT_PRECIPITATION_VARIABLE,
    DEFAULT_PREFERRED_COUNTRY_IDS,
    DEFAULT_REGIONS_PATH,
    DEFAULT_REGISTRY_PATH,
    DEFAULT_TARGET_CASES,
    DEFAULT_TRENDS_DIR,
    DEFAULT_WINDOW_PRIORITY_BONUS,
    build_cases_file,
    build_caution_candidate,
    build_global_caution_candidate,
    combine_quality_flags,
    country_candidates,
    load_cases_config,
    pattern_candidates,
    select_cases,
    trend_candidates,
    witness_agreement_grid,
    write_cases,
)
from earthpulse.patterns import pattern_class

REGISTRY_PATH = DEFAULT_REGISTRY_PATH
REGIONS_PATH = DEFAULT_REGIONS_PATH
PROJECT_ROOT = DEFAULT_TRENDS_DIR.parents[2]
DEFAULT_MASK_PATH = PROJECT_ROOT / "data" / "interim" / "harmonized_monthly" / "common_mask.nc"
DEFAULT_WITNESS_TRENDS_DIR = PROJECT_ROOT / "data" / "processed" / "witness" / "trends"
DEFAULT_ANOMALY_DIR = PROJECT_ROOT / "data" / "processed" / "anomalies"
DEFAULT_WITNESS_ANOMALY_DIR = PROJECT_ROOT / "data" / "processed" / "witness" / "anomalies"


def _read_yaml(path: Path) -> dict:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected a YAML mapping")
    return data


def _load_registry(path: Path) -> dict:
    registry = _read_yaml(path)
    if "variables" not in registry:
        raise ValueError(f"{path}: missing 'variables'")
    return registry


def _load_region_config(path: Path) -> list[dict]:
    regions = _read_yaml(path).get("regions", [])
    if not isinstance(regions, list):
        raise ValueError(f"{path}: 'regions' must be a list")
    return regions


def _load_index(export_dir: Path) -> dict:
    path = export_dir / "index.json"
    if not path.is_file():
        raise FileNotFoundError(
            f"{path} is missing; run scripts/p_export.py before P06"
        )
    import json

    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected a JSON object")
    return data


def _load_trend_layers(path: Path) -> dict[str, np.ndarray] | None:
    if not path.is_file():
        return None
    required = (
        "trend_class",
        "sen_slope_decade",
        "std_change_decade",
        "q_value",
        "p_value",
        "n_valid",
        "coverage",
    )
    ds = xr.open_dataset(path, engine="netcdf4")
    try:
        layers = {name: np.asarray(ds[name].values) for name in required}
        # P08 may add quality layers to the same NetCDF; use them when present.
        if "quality_flag" in ds:
            layers["quality_flag"] = np.asarray(ds["quality_flag"].values, dtype=np.int8)
        return layers
    finally:
        ds.close()


def _load_quality_from_export(
    export_dir: Path, variable: str, window: str
) -> np.ndarray | None:
    path = export_dir / "grids" / variable / window / "quality_flag.i8"
    if not path.is_file():
        return None
    values = np.fromfile(path, dtype=np.int8)
    if values.size != contract.N_ROWS * contract.N_COLS:
        raise ValueError(f"{path}: unexpected quality_flag size {values.size}")
    return values.reshape(contract.N_ROWS, contract.N_COLS)


def _load_breakpoint_from_export(
    export_dir: Path, variable: str, window: str
) -> np.ndarray | None:
    path = export_dir / "grids" / variable / window / "breakpoint_year.f32"
    if not path.is_file():
        return None
    values = np.fromfile(path, dtype="<f4")
    if values.size != contract.N_ROWS * contract.N_COLS:
        raise ValueError(f"{path}: unexpected breakpoint_year size {values.size}")
    return values.reshape(contract.N_ROWS, contract.N_COLS)


def _load_quality(
    export_dir: Path, variable: str, window: str, layers: dict
) -> np.ndarray | None:
    if "quality_flag" in layers:
        return np.asarray(layers["quality_flag"], dtype=np.int8)
    return _load_quality_from_export(export_dir, variable, window)


def _load_i8_grid(path: Path, label: str) -> np.ndarray:
    values = np.fromfile(path, dtype=np.int8)
    if values.size != contract.N_ROWS * contract.N_COLS:
        raise ValueError(f"{path}: unexpected {label} size {values.size}")
    return values.reshape(contract.N_ROWS, contract.N_COLS)


def _load_witness_trend(path: Path) -> dict[str, np.ndarray] | None:
    """P13 witness trend file, or None when that variable/window was not run."""

    if not path.is_file():
        return None
    required = ("trend_class", "sen_slope_decade", "q_value")
    ds = xr.open_dataset(path, engine="netcdf4")
    try:
        missing = [name for name in required if name not in ds]
        if missing:
            raise ValueError(f"{path}: missing witness fields {missing}")
        return {name: np.asarray(ds[name].values) for name in required}
    finally:
        ds.close()


def _witness_layers_for(
    export_dir: Path,
    witness_trends_dir: Path,
    variable: str,
    window: str,
    main_layers: dict,
    mask: np.ndarray,
) -> dict[str, np.ndarray] | None:
    """Agreement from the export grid, else computed from P13 witness trends.

    Sen slope and q always come from the witness trend file.  The export only
    stores the agreement code and the standardized change, not the slope.
    """

    agreement_path = (
        export_dir / "grids" / variable / window / "witness_agreement.i8"
    )
    agreement = (
        _load_i8_grid(agreement_path, "witness_agreement")
        if agreement_path.is_file()
        else None
    )
    trend = _load_witness_trend(witness_trends_dir / variable / f"{window}.nc")
    if agreement is None and trend is not None:
        agreement = witness_agreement_grid(main_layers, trend, mask)
    if agreement is None:
        return None
    if trend is None:
        empty = np.full(agreement.shape, np.nan)
        slope = empty
        q_value = empty
        trend_class = None
    else:
        slope = trend["sen_slope_decade"]
        q_value = trend["q_value"]
        trend_class = trend["trend_class"]
    return {
        "agreement": agreement,
        "sen_slope_decade": slope,
        "q_value": q_value,
        "trend_class": trend_class,
    }


def _load_pattern_layer(
    export_dir: Path,
    window: str,
    temperature: np.ndarray,
    moisture: np.ndarray,
) -> np.ndarray:
    path = export_dir / "patterns" / window / "pattern_class.i8"
    if path.is_file():
        values = np.fromfile(path, dtype=np.int8)
        if values.size != contract.N_ROWS * contract.N_COLS:
            raise ValueError(f"{path}: unexpected pattern_class size {values.size}")
        return values.reshape(contract.N_ROWS, contract.N_COLS)
    return pattern_class(temperature, moisture)


def _load_country_context(export_dir: Path) -> tuple[list[dict], np.ndarray | None]:
    """Countries and country grid from the export, then P10's config fallback."""

    import json

    regions_path = export_dir / "regions.json"
    if regions_path.is_file():
        data = json.loads(regions_path.read_text(encoding="utf-8"))
        countries = data.get("countries") or []
        grid_name = data.get("country_grid")
        if countries and grid_name:
            grid_path = export_dir / grid_name
            if grid_path.is_file():
                values = np.fromfile(grid_path, dtype="<i2")
                if values.size != contract.N_ROWS * contract.N_COLS:
                    raise ValueError(
                        f"{grid_path}: unexpected country grid size {values.size}"
                    )
                return list(countries), values.reshape(
                    contract.N_ROWS, contract.N_COLS
                )

    geojson_path = PROJECT_ROOT / "config" / "countries" / "countries-50m.geojson"
    if geojson_path.is_file():
        try:
            from earthpulse.regions import build_country_grid
        except ImportError:
            return [], None
        grid, countries = build_country_grid(geojson_path)
        return list(countries), np.asarray(grid)
    return [], None


def _load_screener_witness_fraction(
    export_dir: Path,
    window: str,
    domain: str,
    variable: str,
    field: str,
) -> float | None:
    """Read one optional witness fraction from a Screener file."""

    path = export_dir / "screener" / window / f"{domain}.json"
    if not path.is_file():
        return None
    import json

    data = json.loads(path.read_text(encoding="utf-8"))
    for row in data.get("rows", []):
        if row.get("variable") == variable:
            value = row.get(field)
            return float(value) if value is not None else None
    return None


def _mask_path(explicit: Path | None) -> Path:
    if explicit is not None:
        return explicit
    if DEFAULT_MASK_PATH.is_file():
        return DEFAULT_MASK_PATH
    return PROJECT_ROOT / "data" / "processed" / "anomalies" / "common_mask.nc"


def _load_mask(path: Path) -> np.ndarray:
    ds = xr.open_dataset(path, engine="netcdf4")
    try:
        if "common_mask" in ds:
            values = np.asarray(ds["common_mask"].values)
        else:
            (name,) = ds.data_vars
            values = np.asarray(ds[name].values)
        if values.shape != (contract.N_ROWS, contract.N_COLS):
            raise ValueError(f"{path}: unexpected mask shape {values.shape}")
        return values.astype(bool, copy=False)
    finally:
        ds.close()


def _case_annual_series(
    path: Path, rows: np.ndarray, cols: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Area-weighted annual means of monthly anomalies over the case cells."""

    ds = xr.open_dataset(path, engine="netcdf4")
    try:
        anomaly = np.asarray(ds["anomaly"].values, dtype=float)
        years = np.asarray(ds["time"].dt.year.values, dtype=int)
    finally:
        ds.close()
    weights = np.cos(np.deg2rad(contract.row_to_lat(np.asarray(rows, dtype=int))))
    annual_years: list[int] = []
    annual_values: list[float] = []
    for year in sorted(set(int(value) for value in years)):
        block = anomaly[years == year][:, rows, cols]
        values = block  # (months, cells)
        valid = np.isfinite(values)
        denominator = valid * weights[None, :]
        denom_sum = denominator.sum(axis=1)
        with np.errstate(invalid="ignore", divide="ignore"):
            monthly = np.where(
                denom_sum > 0,
                np.nansum(np.where(valid, values, 0.0) * weights[None, :], axis=1)
                / denom_sum,
                np.nan,
            )
        annual_years.append(year)
        annual_values.append(
            float(np.nanmean(monthly)) if np.isfinite(monthly).any() else np.nan
        )
    return np.asarray(annual_years), np.asarray(annual_values)


def _lasting_shift(
    rows: np.ndarray, cols: np.ndarray, break_year: float
) -> dict:
    """P06f: mean(annual anomaly, years >= break) - mean(years < break)."""

    years, main = _case_annual_series(
        DEFAULT_ANOMALY_DIR / "air_temperature.nc", rows, cols
    )
    witness_years, witness = _case_annual_series(
        DEFAULT_WITNESS_ANOMALY_DIR / "air_temperature.nc", rows, cols
    )
    if not np.array_equal(years, witness_years):
        raise ValueError("main and witness anomaly year labels differ")

    before = years < float(break_year)
    after = years >= float(break_year)

    def _shift(values: np.ndarray) -> float | None:
        if np.isfinite(values[before]).any() and np.isfinite(values[after]).any():
            return float(np.nanmean(values[after]) - np.nanmean(values[before]))
        return None

    finite = np.isfinite(main) & np.isfinite(witness)
    correlation = None
    if finite.sum() >= 3:
        correlation = float(np.corrcoef(main[finite], witness[finite])[0, 1])
    return {
        "break_year": float(break_year),
        "main": _shift(main),
        "witness": _shift(witness),
        "annual_correlation": correlation,
    }


def _windows(index: dict) -> list[str]:
    windows = [item["id"] for item in index.get("windows", []) if "id" in item]
    return windows or sorted(contract.WINDOWS)


def _render_maps(
    selected: list[dict],
    cases_file: dict,
    mask: np.ndarray,
    out_dir: Path,
) -> list[Path]:
    """Write one simple PNG map snapshot per selected case."""

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle

    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for candidate, case in zip(selected, cases_file["cases"]):
        figure, axes = plt.subplots(figsize=(12.0, 6.0))
        axes.imshow(
            mask,
            extent=[-180.0, 180.0, -90.0, 90.0],
            origin="upper",
            cmap="Greys",
            alpha=0.55,
            aspect="auto",
        )
        rows = np.asarray(candidate["rows"], dtype=float)
        cols = np.asarray(candidate["cols"], dtype=float)
        longitudes = contract.LON_WEST_CENTER + cols
        latitudes = contract.LAT_NORTH_CENTER - rows
        colour = "#d62728" if int(candidate["trend_class"]) >= 0 else "#1f77b4"
        axes.scatter(longitudes, latitudes, s=8, c=colour, marker="s")

        west, south, east, north = (float(v) for v in candidate["bbox"])
        if west <= east:
            axes.add_patch(
                Rectangle(
                    (west, south),
                    east - west,
                    north - south,
                    fill=False,
                    edgecolor="black",
                    linewidth=1.2,
                )
            )
        else:
            for start, end in ((west, 180.0), (-180.0, east)):
                axes.add_patch(
                    Rectangle(
                        (start, south),
                        end - start,
                        north - south,
                        fill=False,
                        edgecolor="black",
                        linewidth=1.2,
                    )
                )
        axes.set_xlim(-180.0, 180.0)
        axes.set_ylim(-90.0, 90.0)
        axes.set_xlabel("longitude (degrees)")
        axes.set_ylabel("latitude (degrees)")
        axes.set_title(case["title"])
        axes.grid(True, linewidth=0.25, alpha=0.4)
        figure.tight_layout()
        path = out_dir / f"{case['id']}.png"
        figure.savefig(path, dpi=110)
        plt.close(figure)
        written.append(path)
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export-dir", type=Path, default=DEFAULT_EXPORT_DIR)
    parser.add_argument("--trends-dir", type=Path, default=DEFAULT_TRENDS_DIR)
    parser.add_argument("--registry", type=Path, default=REGISTRY_PATH)
    parser.add_argument("--regions-config", type=Path, default=REGIONS_PATH)
    parser.add_argument("--cases-config", type=Path, default=DEFAULT_CASES_CONFIG_PATH)
    parser.add_argument("--mask", type=Path, default=None)
    parser.add_argument(
        "--witness-trends-dir",
        type=Path,
        default=DEFAULT_WITNESS_TRENDS_DIR,
        help="P13 witness trend NetCDFs (used when the export has no agreement grid)",
    )
    parser.add_argument(
        "--min-cluster-cells",
        type=int,
        default=None,
        help=f"minimum eligible cells per cluster (default: config or {DEFAULT_MIN_CLUSTER_CELLS})",
    )
    parser.add_argument(
        "--max-cases",
        type=int,
        default=None,
        help=f"maximum number of cases (default: config or {DEFAULT_MAX_CASES})",
    )
    parser.add_argument(
        "--maps-dir",
        type=Path,
        default=None,
        help="optional directory for PNG map snapshots (not part of the export)",
    )
    args = parser.parse_args(argv)

    started = time.perf_counter()
    export_dir = args.export_dir
    if not export_dir.is_dir():
        print(f"ERROR: export folder does not exist: {export_dir}", file=sys.stderr)
        return 1

    config = load_cases_config(args.cases_config)
    min_cluster_cells = int(
        args.min_cluster_cells
        if args.min_cluster_cells is not None
        else config.get("min_cluster_cells", DEFAULT_MIN_CLUSTER_CELLS)
    )
    max_cases = int(
        args.max_cases
        if args.max_cases is not None
        else config.get("max_cases", DEFAULT_MAX_CASES)
    )
    target_cases = int(config.get("target_cases", DEFAULT_TARGET_CASES))

    registry = _load_registry(args.registry)
    regions = _load_region_config(args.regions_config)
    index = _load_index(export_dir)
    mask = _load_mask(_mask_path(args.mask))
    variables = [
        variable
        for variable in registry["variables"]
        if variable.get("verified")
    ]
    windows = _windows(index)
    pattern_pair = index.get("pattern_pair") or {
        "temperature": "surface_skin_temperature",
        "moisture": "root_zone_soil_moisture",
    }
    temperature_variable = str(pattern_pair["temperature"])
    moisture_variable = str(pattern_pair["moisture"])

    trend_cache: dict[tuple[str, str], dict] = {}
    quality_cache: dict[tuple[str, str], np.ndarray | None] = {}
    witness_cache: dict[tuple[str, str], dict] = {}
    quality_check_windows: dict[tuple[str, str], tuple[str, ...]] = {}
    candidates: list[dict] = []
    skipped: list[str] = []

    # Load all trend layers first so the 2001-2024 quality layer is available
    # when a 12-year window is evaluated.
    for window in windows:
        for variable in variables:
            variable_id = str(variable["id"])
            path = args.trends_dir / variable_id / f"{window}.nc"
            layers = _load_trend_layers(path)
            if layers is None:
                skipped.append(f"{variable_id}/{window}")
                continue
            trend_cache[(variable_id, window)] = layers

    for (variable_id, window), layers in trend_cache.items():
        quality_cache[(variable_id, window)] = _load_quality(
            export_dir, variable_id, window, layers
        )
        witness = _witness_layers_for(
            export_dir,
            args.witness_trends_dir,
            variable_id,
            window,
            layers,
            mask,
        )
        if witness is not None:
            witness_cache[(variable_id, window)] = witness
    if witness_cache:
        print(f"Witness layers: {len(witness_cache)} variable/window grids")
    else:
        print(
            "Witness layers not available yet (export has no witness_agreement "
            "grid and P13 witness trends are absent); evidence.witness omitted."
        )

    for window in windows:
        for variable in variables:
            variable_id = str(variable["id"])
            key = (variable_id, window)
            layers = trend_cache.get(key)
            if layers is None:
                continue
            quality = quality_cache.get(key)
            check_windows = [window]
            if window != "2001-2024":
                quality_2001_2024 = quality_cache.get((variable_id, "2001-2024"))
                if quality_2001_2024 is not None:
                    quality = combine_quality_flags(quality, quality_2001_2024)
                    quality_cache[key] = quality
                    check_windows.append("2001-2024")
            quality_check_windows[key] = tuple(check_windows)
            candidates.extend(
                trend_candidates(
                    layers,
                    variable_id,
                    window,
                    mask=mask,
                    quality_flag=quality,
                    quality_check_windows=tuple(check_windows),
                    min_cluster_cells=min_cluster_cells,
                    regions=regions,
                    witness_layers=witness_cache.get(key),
                )
            )

    for window in windows:
        temperature_layers = trend_cache.get((temperature_variable, window))
        moisture_layers = trend_cache.get((moisture_variable, window))
        if temperature_layers is None or moisture_layers is None:
            continue
        pattern_layer = _load_pattern_layer(
            export_dir,
            window,
            temperature_layers["trend_class"],
            moisture_layers["trend_class"],
        )
        quality_flags = {
            variable_id: quality
            for variable_id, quality in (
                (temperature_variable, quality_cache.get((temperature_variable, window))),
                (moisture_variable, quality_cache.get((moisture_variable, window))),
            )
            if quality is not None
        }
        pattern_check = [window]
        if any(
            "2001-2024" in quality_check_windows.get((variable_id, window), ())
            for variable_id in (temperature_variable, moisture_variable)
        ):
            pattern_check.append("2001-2024")
        candidates.extend(
            pattern_candidates(
                {
                    temperature_variable: temperature_layers,
                    moisture_variable: moisture_layers,
                },
                temperature_variable,
                moisture_variable,
                window,
                pattern_layer=pattern_layer,
                mask=mask,
                quality_flags=quality_flags,
                quality_check_windows=tuple(pattern_check),
                min_cluster_cells=min_cluster_cells,
                regions=regions,
                witness_by_variable={
                    variable_id: witness_cache[(variable_id, window)]
                    for variable_id in (temperature_variable, moisture_variable)
                    if (variable_id, window) in witness_cache
                }
                or None,
            )
        )

    countries, country_grid = _load_country_context(export_dir)
    if countries and country_grid is not None:
        for window in windows:
            layers_by_variable = {
                variable_id: layers
                for (variable_id, cached_window), layers in trend_cache.items()
                if cached_window == window
            }
            if not layers_by_variable:
                continue
            quality_flags = {
                variable_id: quality_cache.get((variable_id, window))
                for variable_id in layers_by_variable
                if quality_cache.get((variable_id, window)) is not None
            }
            country_check = [window]
            if any(
                "2001-2024" in quality_check_windows.get((variable_id, window), ())
                for variable_id in layers_by_variable
            ):
                country_check.append("2001-2024")
            candidates.extend(
                country_candidates(
                    layers_by_variable,
                    country_grid,
                    countries,
                    window,
                    mask=mask,
                    quality_flags=quality_flags,
                    quality_check_windows=tuple(country_check),
                    min_cells=min_cluster_cells,
                    regions=regions,
                    witness_by_variable={
                        variable_id: witness_cache[(variable_id, window)]
                        for variable_id in layers_by_variable
                        if (variable_id, window) in witness_cache
                    }
                    or None,
                )
            )

    selection_notes: list[str] = []
    selected = select_cases(
        candidates,
        max_cases=max_cases,
        target_cases=target_cases,
        precipitation_variable=DEFAULT_PRECIPITATION_VARIABLE,
        regions=regions,
        preferred_country_ids=DEFAULT_PREFERRED_COUNTRY_IDS,
        min_place_cells=min_cluster_cells,
        window_priority_bonus=DEFAULT_WINDOW_PRIORITY_BONUS,
        countries=countries,
        country_grid=country_grid,
        selection_notes=selection_notes,
    )
    for note in selection_notes:
        print(f"Selection note: {note}")

    # P06c: replace the Vietnam slot with exactly one caution case built from
    # the whole Vietnam air-temperature country domain, including flagged cells.
    caution = None
    caution_reason = ""
    vietnam_country = next(
        (
            country
            for country in countries
            if str(country.get("id")) == "country_704"
            or str(country.get("label") or "").strip().lower() == "vietnam"
        ),
        None,
    )
    air_layers = trend_cache.get(("air_temperature", "2001-2024"))
    air_quality = quality_cache.get(("air_temperature", "2001-2024"))
    if vietnam_country is None:
        caution_reason = "Vietnam is not present in the country grid metadata"
    elif country_grid is None:
        caution_reason = "the country grid is not available"
    elif air_layers is None:
        caution_reason = "air_temperature/2001-2024 trend layers are missing"
    elif air_quality is None:
        caution_reason = "air_temperature/2001-2024 quality flags are missing"
    else:
        breakpoint_year = _load_breakpoint_from_export(
            export_dir, "air_temperature", "2001-2024"
        )
        caution, caution_reason = build_caution_candidate(
            air_layers,
            "air_temperature",
            "2001-2024",
            vietnam_country,
            country_grid,
            mask=mask,
            quality_flag=air_quality,
            breakpoint_year=breakpoint_year,
            min_cells=min_cluster_cells,
            regions=regions,
            witness_layers=witness_cache.get(("air_temperature", "2001-2024")),
        )

    if caution is not None:
        if caution.get("break_year") is not None:
            try:
                caution["lasting_shift"] = _lasting_shift(
                    np.asarray(caution["rows"]),
                    np.asarray(caution["cols"]),
                    float(caution["break_year"]),
                )
            except (FileNotFoundError, ValueError) as exc:
                print(f"Warning: lasting shift could not be computed: {exc}")
        selected = [
            candidate
            for candidate in selected
            if candidate.get("role") != "southeast-asia"
        ]
        selected = [
            candidate
            for candidate in selected
            if not (
                str(candidate.get("country_id") or "") == "country_704"
                and candidate.get("variable") == "air_temperature"
                and candidate.get("window") == "2001-2024"
            )
        ]
        if len(selected) >= max_cases:
            selected = selected[: max_cases - 1]
        caution["role"] = "caution"
        selected.append(caution)
        print(
            "Caution case: Vietnam air temperature 2001–2024 built from the "
            "country domain, flagged cells included."
        )
    else:
        print(
            f"Caution case not built: {caution_reason}. Falling back to the "
            "current Southeast Asia rule."
        )

    # P06f: second caution case, global specific humidity 2001-2024.
    global_caution = None
    global_caution_reason = ""
    humidity_layers = trend_cache.get(("specific_humidity", "2001-2024"))
    humidity_quality = quality_cache.get(("specific_humidity", "2001-2024"))
    humidity_witness = witness_cache.get(("specific_humidity", "2001-2024"))
    if humidity_layers is None:
        global_caution_reason = "specific_humidity/2001-2024 trend layers are missing"
    elif humidity_quality is None:
        global_caution_reason = "specific_humidity/2001-2024 quality flags are missing"
    elif humidity_witness is None:
        global_caution_reason = "specific_humidity witness layers are missing"
    else:
        screener_contradicted = _load_screener_witness_fraction(
            export_dir,
            "2001-2024",
            "global",
            "specific_humidity",
            "witness_contradicted_fraction",
        )
        global_caution, global_caution_reason = build_global_caution_candidate(
            humidity_layers,
            "specific_humidity",
            "2001-2024",
            mask,
            quality_flag=humidity_quality,
            witness_layers=humidity_witness,
            regions=regions,
            min_cells=min_cluster_cells,
            screener_contradicted_fraction=screener_contradicted,
        )
    if global_caution is not None:
        selected = [
            candidate
            for candidate in selected
            if not (
                candidate.get("variable") == "specific_humidity"
                and candidate.get("window") == "2001-2024"
            )
        ]
        if len(selected) >= max_cases:
            selected = selected[: max_cases - 1]
        global_caution["role"] = "caution"
        selected.append(global_caution)
        print(
            "Caution case: global specific humidity 2001–2024 witness "
            "disagreement added."
        )
    else:
        print(
            f"Global humidity caution case not built: {global_caution_reason}."
        )

    cases_file = build_cases_file(
        selected,
        registry,
        config=config,
        countries=countries,
        country_grid=country_grid,
    )
    output_path = write_cases(cases_file, export_dir / "cases.json")

    print(
        f"P06: {len(candidates)} candidates from {len(trend_cache)} trend grids, "
        f"{len(selected)} cases written to {output_path}"
    )
    if skipped:
        print(f"Skipped missing trend grids: {len(skipped)}")
        for item in skipped:
            print(f"  - {item}")
    if len(selected) < target_cases:
        print(
            f"WARNING: only {len(selected)} cases met the documented rules "
            f"(target {target_cases}); no case was forced."
        )

    if caution is None:
        place_boxes = [
            region["bbox"]
            for region in regions
            if region.get("id") in {"mekong", "southeast_asia"} and region.get("bbox")
        ]

        def _in_place(candidate: dict) -> bool:
            latitude, longitude = candidate.get("center", (0.0, 0.0))
            for west, south, east, north in place_boxes:
                if not (south <= latitude <= north):
                    continue
                if west <= east:
                    if west <= longitude <= east:
                        return True
                elif longitude >= west or longitude <= east:
                    return True
            return False

        vietnam_selected = [
            candidate
            for candidate in selected
            if str(candidate.get("country_id") or "") == "country_704"
            or str(candidate.get("label") or "").strip().lower() == "vietnam"
        ]
        if vietnam_selected:
            print("Southeast Asia slot: Vietnam case selected.")
        elif any(_in_place(candidate) for candidate in selected):
            print(
                "Southeast Asia slot: no Vietnam case was available; used the "
                "next preferred supported Mekong / Southeast Asia candidate."
            )
        else:
            print(
                "Southeast Asia slot omitted: no Vietnam / Mekong / Southeast Asia "
                f"candidate with >= {min_cluster_cells} eligible cells after quality "
                "screening."
            )

    for number, candidate in enumerate(selected, start=1):
        print(
            f"  case-{number:02d} [{candidate.get('role')}] "
            f"{candidate['variable']} {candidate['window']} "
            f"kind={candidate.get('kind')} class={candidate.get('trend_class')} "
            f"cells={candidate['cells']} score={float(candidate['score']):.3f} "
            f"quality={candidate.get('quality_check_windows')} "
            f"adjust={candidate.get('score_adjustment', 1.0)} "
            f"bbox={candidate['bbox']}"
        )

    if args.maps_dir is not None:
        maps = _render_maps(selected, cases_file, mask, args.maps_dir)
        print(f"Map snapshots: {len(maps)} PNG files in {args.maps_dir}")
        for path in maps:
            print(f"  - {path}")

    print(f"Total wall time: {time.perf_counter() - started:.1f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
