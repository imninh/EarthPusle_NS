"""P02 T3/T4: harmonization of raw NASA monthly files onto the contract grid.

Turns the raw GLDAS_NOAH10_M and GPM_3IMERGM monthly files into one clean
monthly cube per registry variable (``config/variables.yaml``), in display
units on the contract grid (180 x 360, row 0 = north), plus the common land
mask that defines the contract domain.

Key rules (P02 spec, decisions from the P01 review):

- Read unit conversions, fill values and open settings from the registry —
  never hard-coded constants.
- Mask the fill value **before** any arithmetic.
- "per month" conversions use the exact number of seconds / hours in that
  calendar month (leap years included).
- IMERG is stored ``(time, lon, lat)`` at 0.1°: transpose **by dimension
  name**, then aggregate to 1° with :func:`earthpulse.grid.block_aggregate`.
- GLDAS is native 1° with centres −59.5..89.5: no regridding, only the
  north-first flip and placement into the 180-row contract grid.
- Process month by month; never load all raw files into RAM at once.
"""

from __future__ import annotations

import calendar
from pathlib import Path

import cftime
import numpy as np
import xarray as xr
import yaml

from earthpulse import contract
from earthpulse.grid import (
    COARSE_VALID_AREA_FRACTION,
    block_aggregate,
    target_grid,
    to_contract_orientation,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = PROJECT_ROOT / "config" / "variables.yaml"
RAW_SUBDIRS = {
    "GLDAS_NOAH10_M": "gldas",
    "GPM_3IMERGM": "gpm",
    # G1 (P24 T2 pilot): MERRA-2 files already on disk from P13 (no new download).
    "M2TMNXSLV": "witness/M2TMNXSLV",
}

# A cell enters the common mask only when each criterion holds in at least
# this fraction of the 288 months (P02 spec T4).
COMMON_MASK_MIN_MONTH_FRACTION = 0.8

# GLDAS-2 README §1.6: no glacier/ice-sheet model; SWE accumulates forever over
# Greenland and permanent snow/ice. P08 excludes a cell when its minimum monthly
# SWE over 2001-2024 exceeds this threshold (kg m-2 = mm water equivalent).
# The 2026-11-09 real-data histogram has a clear gap between 1 and 10 kg m-2;
# 10 removes 909 of 15,159 cells (615/626 Greenland cells) and no mid-latitude
# seasonal-snow cell.
PERMANENT_SNOW_MIN_SWE = 10.0
SWE_PRODUCT = "GLDAS_NOAH10_M"
SWE_CACHE_NAME = "swe_min.nc"


def load_registry(path: Path | str | None = None) -> dict:
    """Load ``config/variables.yaml`` (the architect-owned variable registry)."""
    with open(path or REGISTRY_PATH, encoding="utf-8") as handle:
        return yaml.safe_load(handle)


# ---------------------------------------------------------------------------
# Calendar conversions
# ---------------------------------------------------------------------------


def hours_in_month(year: int, month: int) -> float:
    """Exact number of hours in a calendar month (leap years included)."""
    return calendar.monthrange(year, month)[1] * 24.0


def seconds_in_month(year: int, month: int) -> float:
    """Exact number of seconds in a calendar month (leap years included)."""
    return calendar.monthrange(year, month)[1] * 86400.0


def convert_units(da: xr.DataArray, conversion: str, year: int, month: int) -> xr.DataArray:
    """Convert a native monthly value to the registry display unit.

    Supported conversions (registry ``conversion`` field):

    - ``identity``: value already in the display unit.
    - ``kelvin_to_celsius``: subtract 273.15.
    - ``per_hour_to_per_month``: multiply by the exact hours in the month
      (IMERG mm/hr → mm/month; 1 kg m-2 of water = 1 mm).
    - ``per_second_to_per_month``: multiply by the exact seconds in the
      month (GLDAS kg m-2 s-1 → mm/month).
    - ``kg_per_kg_to_g_per_kg``: multiply by 1000.
    """
    if conversion == "identity":
        return da
    if conversion == "kelvin_to_celsius":
        return da - 273.15
    if conversion == "per_hour_to_per_month":
        return da * hours_in_month(year, month)
    if conversion == "per_second_to_per_month":
        return da * seconds_in_month(year, month)
    if conversion == "kg_per_kg_to_g_per_kg":
        return da * 1000.0
    raise ValueError(f"Unknown registry conversion {conversion!r}")


def mask_fill(da: xr.DataArray, fill_value: float) -> xr.DataArray:
    """Replace the fill value (and any non-finite values) with NaN.

    Must run before any arithmetic so that fill values never enter means.
    """
    da = da.astype(np.float64).where(da != float(fill_value))
    return da


# ---------------------------------------------------------------------------
# Time handling
# ---------------------------------------------------------------------------


def month_of_time_value(value) -> tuple[int, int]:
    """Return (year, month) of a decoded time value.

    Handles ``numpy.datetime64`` and ``cftime`` objects (IMERG uses a Julian
    calendar, GLDAS a standard one; both decode to month starts per P01).
    """
    if isinstance(value, np.datetime64):
        return int(str(value)[:4]), int(str(value)[5:7])
    return int(value.year), int(value.month)


def raw_file_pattern(product_short_name: str, year: int, month: int) -> str:
    """Glob pattern for one product's monthly file (P01-verified names)."""
    if product_short_name == "GLDAS_NOAH10_M":
        return f"GLDAS_NOAH10_M.A{year:04d}{month:02d}.*.nc4"
    if product_short_name == "GPM_3IMERGM":
        return f"3B-MO.MS.MRG.3IMERG.{year:04d}{month:02d}01-*.HDF5"
    if product_short_name == "M2TMNXSLV":
        return f"MERRA2_*.tavgM_2d_slv_Nx.{year:04d}{month:02d}.nc4"
    raise ValueError(f"No file-name pattern for product {product_short_name!r}")


def find_raw_file(raw_root: Path, product_short_name: str, year: int, month: int) -> Path:
    """Locate one monthly raw file; raise (never fill) when it is missing."""
    directory = raw_root / RAW_SUBDIRS[product_short_name]
    matches = sorted(directory.glob(raw_file_pattern(product_short_name, year, month)))
    if len(matches) != 1:
        raise FileNotFoundError(
            f"Expected exactly 1 raw file for {product_short_name} "
            f"{year:04d}-{month:02d} in {directory}, found {len(matches)}. "
            "Run scripts/p02_download.py and resolve gaps before harmonizing."
        )
    return matches[0]


# ---------------------------------------------------------------------------
# Per-month transformation
# ---------------------------------------------------------------------------


def open_month(path: Path, product_cfg: dict) -> xr.Dataset:
    """Open one raw monthly file with the registry ``open_with`` settings.

    ``mask_and_scale=False`` keeps fill values raw so that they can be
    masked explicitly with the registry fill value.
    """
    open_with = product_cfg["open_with"]
    return xr.open_dataset(
        path,
        engine=open_with.get("engine", "netcdf4"),
        group=open_with.get("group"),
        decode_times=True,
        mask_and_scale=False,
    )


def transform_month(
    da: xr.DataArray,
    variable_cfg: dict,
    product_cfg: dict,
    year: int,
    month: int,
) -> tuple[xr.DataArray, xr.DataArray | None]:
    """One month's native array → contract-grid (value, valid_fraction).

    Steps: mask fill values, convert to the display unit, bring to contract
    orientation, and aggregate to 1° with area weights when the native
    resolution is finer (IMERG). ``valid_fraction`` is None for native-1°
    products (GLDAS).
    """
    fill = product_cfg["fill_value"]
    da = mask_fill(da, fill)
    var_fill = da.attrs.get("_FillValue")
    if var_fill is not None and float(var_fill) != float(fill):
        da = mask_fill(da, var_fill)

    da = convert_units(da, variable_cfg["conversion"], year, month)
    da = to_contract_orientation(da)

    native = float(product_cfg.get("native_resolution_deg", contract.RESOLUTION_DEG))
    if np.isclose(native, contract.RESOLUTION_DEG):
        return da, None
    factor = int(round(contract.RESOLUTION_DEG / native))
    return block_aggregate(da, factor=factor)


# ---------------------------------------------------------------------------
# Variable-level harmonization
# ---------------------------------------------------------------------------


def expected_months() -> list[tuple[int, int]]:
    """(year, month) pairs for the 288 contract months, in order."""
    start = tuple(int(p) for p in contract.FIRST_MONTH.split("-"))
    end = tuple(int(p) for p in contract.LAST_MONTH.split("-"))
    months = []
    year, month = start
    while (year, month) <= end:
        months.append((year, month))
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return months


def harmonize_variable(
    variable_cfg: dict,
    product_cfg: dict,
    raw_root: Path,
    out_path: Path,
) -> Path:
    """Harmonize one registry variable into ``data/interim/harmonized_monthly``.

    Writes a float32 ``(time, lat, lon)`` cube with attributes ``units``,
    ``source_product``, ``source_variable``, ``conversion`` and ``doi``; for
    IMERG a companion ``valid_fraction`` variable records the valid fine-cell
    area fraction of each 1° cell per month.
    """
    if product_cfg.get("regrid") == "conservative":
        return harmonize_variable_conservative(
            variable_cfg, product_cfg, raw_root, out_path
        )
    months = expected_months()
    lat, lon = target_grid()
    n = len(months)
    values = np.full((n, contract.N_ROWS, contract.N_COLS), np.nan, dtype=np.float32)
    fractions = (
        np.full((n, contract.N_ROWS, contract.N_COLS), np.nan, dtype=np.float32)
        if variable_cfg["product"] == "GPM_3IMERGM"
        else None
    )
    time_coords = np.array(
        [np.datetime64(f"{y:04d}-{m:02d}", "M") for y, m in months]
    )

    for index, (year, month) in enumerate(months):
        path = find_raw_file(raw_root, variable_cfg["product"], year, month)
        with open_month(path, product_cfg) as dataset:
            # The file's own decoded timestamp must be the expected month
            # start (P01: both products time-stamp month starts).
            stamp = dataset["time"].values[0]
            found = month_of_time_value(stamp)
            if found != (year, month):
                raise RuntimeError(
                    f"{path.name}: decoded time {stamp!r} is "
                    f"{found[0]:04d}-{found[1]:02d}, expected "
                    f"{year:04d}-{month:02d}; refusing to substitute."
                )
            da = dataset[variable_cfg["source_variable"]]
            if "time" in da.dims:
                da = da.isel(time=0)
            value, fraction = transform_month(da, variable_cfg, product_cfg, year, month)
        values[index] = value.values
        if fractions is not None:
            fractions[index] = fraction.values

    data_vars: dict[str, xr.DataArray] = {
        variable_cfg["id"]: xr.DataArray(
            values,
            dims=("time", "lat", "lon"),
            coords={"time": time_coords, "lat": lat, "lon": lon},
            attrs={
                "long_name": variable_cfg["label"],
                "description": variable_cfg["description"],
            },
        )
    }
    if fractions is not None:
        data_vars["valid_fraction"] = xr.DataArray(
            fractions,
            dims=("time", "lat", "lon"),
            coords={"time": time_coords, "lat": lat, "lon": lon},
            attrs={
                "long_name": "Valid fine-cell area fraction of each 1° cell",
                "comment": (
                    "Fraction of the 0.1° fine-cell area that is valid in "
                    "each 1° cell (cos(lat) weighted); a 1° cell is treated "
                    f"as valid in a month when >= {COARSE_VALID_AREA_FRACTION}."
                ),
            },
        )

    cube = xr.Dataset(
        data_vars,
        attrs={
            "title": f"EarthPulse harmonized monthly {variable_cfg['label']}",
            "units": variable_cfg["display_unit"],
            "source_product": variable_cfg["product"],
            "source_product_version": product_cfg["version"],
            "source_variable": variable_cfg["source_variable"],
            "conversion": variable_cfg["conversion"],
            "doi": product_cfg["doi"],
            "monthly_statistic": variable_cfg["monthly_statistic"],
            "time_coverage": f"{contract.FIRST_MONTH} .. {contract.LAST_MONTH}",
            "time_note": "Timestamp is the start of the month.",
            "grid": (
                f"{contract.N_ROWS}x{contract.N_COLS} 1° cells, row 0 north "
                f"(centre {contract.LAT_NORTH_CENTER}), column 0 west "
                f"(centre {contract.LON_WEST_CENTER})"
            ),
            "fill_value_note": (
                f"Native fill {product_cfg['fill_value']} masked to NaN "
                "before any arithmetic."
            ),
            "package": "P02",
        },
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    encoding = {
        name: {"dtype": "float32", "zlib": True, "complevel": 4}
        for name in cube.data_vars
    }
    cube.to_netcdf(out_path, engine="netcdf4", encoding=encoding)
    return out_path


def _read_native_field(ds: xr.Dataset, name: str) -> tuple[np.ndarray, dict]:
    """One native ``(lat, lon)`` field with its fill value turned into NaN."""
    variable = ds[name]
    values = np.asarray(variable.values, dtype=np.float64)
    if values.ndim == 3:
        values = values[0]
    fill = variable.attrs.get("_FillValue", variable.attrs.get("missing_value"))
    if fill is not None:
        values[values == float(fill)] = np.nan
    values[~np.isfinite(values)] = np.nan
    return values, dict(variable.attrs)


def harmonize_variable_conservative(
    variable_cfg: dict,
    product_cfg: dict,
    raw_root: Path,
    out_path: Path,
    mask_path: Path | None = None,
    weights=None,
) -> Path:
    """Harmonize a fine-grid (non-1 degree) product with the P13 regridder.

    Used for MERRA-2 ``M2TMNXSLV`` (G1 / P24 T2). Steps per month: read the
    native field, mask the file's own fill value, optionally mask native cells
    where a second field is below a limit (T850: ``PS < 85000 Pa``), convert
    units, regrid conservatively (``earthpulse.witness``, cos-latitude overlap
    weights, missing values excluded) to the contract grid and apply the common
    land mask. ``units`` and ``long_name`` of the source field are read from the
    first raw file and must agree with the registry row.
    """
    from earthpulse import witness  # local import keeps GLDAS/IMERG paths light

    months = expected_months()
    mask_file = Path(mask_path) if mask_path else Path(out_path).parent / "common_mask.nc"
    with xr.open_dataset(mask_file, engine="netcdf4") as mask_ds:
        mask = np.asarray(mask_ds["common_mask"].values, dtype=bool)

    source = variable_cfg["source_variable"]
    limit = variable_cfg.get("valid_where_min")
    first = find_raw_file(raw_root, variable_cfg["product"], *months[0])
    with xr.open_dataset(
        first, engine="netcdf4", decode_times=False, mask_and_scale=False
    ) as ds:
        file_units = ds[source].attrs.get("units")
        file_long_name = ds[source].attrs.get("long_name")
        src_lat = np.asarray(ds["lat"].values, dtype=float)
        src_lon = np.asarray(ds["lon"].values, dtype=float)
    if file_units != variable_cfg["native_unit"]:
        raise RuntimeError(
            f"{source}: file units {file_units!r} != registry native_unit "
            f"{variable_cfg['native_unit']!r}"
        )
    expected_name = variable_cfg.get("source_long_name")
    if expected_name is not None and file_long_name != expected_name:
        raise RuntimeError(
            f"{source}: file long_name {file_long_name!r} != registry "
            f"source_long_name {expected_name!r}"
        )
    if weights is None:
        weights = witness.build_overlap_weights(src_lat, src_lon)

    n_masked_ps = 0
    values = np.full(
        (len(months), contract.N_ROWS, contract.N_COLS), np.nan, dtype=np.float32
    )
    for index, (year, month) in enumerate(months):
        path = find_raw_file(raw_root, variable_cfg["product"], year, month)
        with xr.open_dataset(
            path, engine="netcdf4", decode_times=False, mask_and_scale=False
        ) as ds:
            begin = int(ds["time"].attrs.get("begin_date", 0))
            if begin and begin // 100 != year * 100 + month:
                raise RuntimeError(
                    f"{path.name}: begin_date {begin} is not {year:04d}-{month:02d}; "
                    "refusing to substitute."
                )
            field, _ = _read_native_field(ds, source)
            if limit is not None:
                surface, _ = _read_native_field(ds, limit["source_variable"])
                below = ~(surface >= float(limit["value"]))
                n_masked_ps += int((below & np.isfinite(field)).sum())
                field = np.where(below, np.nan, field)
        field = witness.convert_units(field, variable_cfg["conversion"], year, month)
        regridded = witness.area_weighted_regrid(field, weights, field.shape)
        values[index] = witness.apply_mask(regridded, mask)

    lat, lon = target_grid()
    time_coords = np.array([np.datetime64(f"{y:04d}-{m:02d}", "M") for y, m in months])
    valid_where = "none"
    if limit is not None:
        valid_where = (
            f"{limit['source_variable']} >= {limit['value']} {limit['unit']} "
            f"(native cells; {n_masked_ps} native cell-months masked)"
        )
    cube = xr.Dataset(
        {
            variable_cfg["id"]: xr.DataArray(
                values,
                dims=("time", "lat", "lon"),
                coords={"time": time_coords, "lat": lat, "lon": lon},
                attrs={
                    "long_name": variable_cfg["label"],
                    "description": variable_cfg["description"],
                },
            )
        },
        attrs={
            "title": f"EarthPulse harmonized monthly {variable_cfg['label']}",
            "units": variable_cfg["display_unit"],
            "source_product": variable_cfg["product"],
            "source_product_version": product_cfg["version"],
            "source_variable": source,
            "source_long_name": file_long_name,
            "source_units": file_units,
            "conversion": variable_cfg["conversion"],
            "doi": product_cfg["doi"],
            "monthly_statistic": variable_cfg["monthly_statistic"],
            "time_coverage": f"{contract.FIRST_MONTH} .. {contract.LAST_MONTH}",
            "time_note": "Timestamp is the start of the month.",
            "grid": (
                f"{contract.N_ROWS}x{contract.N_COLS} 1° cells, row 0 north "
                f"(centre {contract.LAT_NORTH_CENTER}), column 0 west "
                f"(centre {contract.LON_WEST_CENTER})"
            ),
            "regrid": "conservative cos(latitude) overlap weights (P13), missing excluded",
            "mask": "common land mask applied; outside is NaN",
            "valid_where": valid_where,
            "package": "G1",
        },
    )
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    encoding = {
        name: {"dtype": "float32", "zlib": True, "complevel": 4}
        for name in cube.data_vars
    }
    cube.to_netcdf(out_path, engine="netcdf4", encoding=encoding)
    return out_path


# ---------------------------------------------------------------------------
# T4: common mask
# ---------------------------------------------------------------------------


def swe_exclusion_mask(
    swe_min: np.ndarray, threshold: float = PERMANENT_SNOW_MIN_SWE
) -> np.ndarray:
    """Boolean mask of cells whose minimum monthly SWE exceeds ``threshold``.

    A finite minimum above the threshold means snow/ice persists in every month
    of 2001-2024 (the GLDAS permanent-snow/ice signature). NaN/invalid cells are
    not excluded here; the GLDAS coverage criterion handles them.
    """

    values = np.asarray(swe_min, dtype=float)
    if values.shape != (contract.N_ROWS, contract.N_COLS):
        raise ValueError(
            f"swe_min must have shape {(contract.N_ROWS, contract.N_COLS)}, "
            f"got {values.shape}"
        )
    return np.isfinite(values) & (values > float(threshold))


def compute_min_swe(
    raw_root: Path,
    cache_path: Path | None = None,
    product: str = SWE_PRODUCT,
) -> np.ndarray:
    """Minimum monthly ``SWE_inst`` for every 1° cell, 2001-2024.

    Reads the 288 raw GLDAS monthly files, masks the fill value, computes the
    per-cell minimum, flips the native 150-row latitude order to the contract's
    north-first 180-row grid, and caches the result as ``swe_min.nc``. The
    cache is independent of the mask threshold and is reused by later mask
    rebuilds.
    """

    if cache_path is not None and Path(cache_path).is_file():
        with xr.open_dataset(Path(cache_path), engine="netcdf4") as cached:
            values = np.asarray(cached["swe_min"].values, dtype=float)
        if values.shape == (contract.N_ROWS, contract.N_COLS):
            return values

    if product not in RAW_SUBDIRS:
        raise ValueError(f"no raw sub-directory for product {product!r}")

    native_min = np.full((150, contract.N_COLS), np.inf, dtype=np.float64)
    months = expected_months()
    missing: list[str] = []
    for year, month in months:
        try:
            path = find_raw_file(Path(raw_root), product, year, month)
        except FileNotFoundError:
            missing.append(f"{year:04d}-{month:02d}")
            continue
        with xr.open_dataset(
            path, engine="netcdf4", decode_times=False, mask_and_scale=False
        ) as ds:
            variable = ds["SWE_inst"]
            fill = variable.attrs.get("_FillValue", -9999.0)
            values = np.asarray(variable.values, dtype=np.float64)
            if values.ndim == 3:
                values = values[0]
            if values.shape != native_min.shape:
                raise ValueError(
                    f"{path.name}: SWE_inst has shape {values.shape}, expected "
                    f"{native_min.shape}"
                )
            values[values == float(fill)] = np.nan
            np.fmin(native_min, values, out=native_min)

    if missing:
        raise FileNotFoundError(
            f"cannot compute SWE mask: {len(missing)} monthly files missing "
            f"(first: {missing[:5]})"
        )

    lat, lon = target_grid()
    grid = np.full((contract.N_ROWS, contract.N_COLS), np.nan, dtype=float)
    # Native GLDAS rows are ascending (-59.5..89.5); contract row 0 is 89.5.
    grid[: native_min.shape[0]] = native_min[::-1]
    grid[~np.isfinite(grid)] = np.nan

    if cache_path is not None:
        cache = xr.Dataset(
            {
                "swe_min": xr.DataArray(
                    grid.astype(np.float32),
                    dims=("lat", "lon"),
                    coords={"lat": lat, "lon": lon},
                    attrs={
                        "units": "kg m-2",
                        "long_name": "Minimum monthly snow water equivalent, 2001-2024",
                    },
                )
            },
            attrs={
                "source_product": product,
                "source_variable": "SWE_inst",
                "period": f"{contract.FIRST_MONTH}..{contract.LAST_MONTH}",
                "rule": "per-cell minimum of monthly values; fill masked to NaN",
            },
        )
        cache_path = Path(cache_path)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache.to_netcdf(
            cache_path,
            engine="netcdf4",
            encoding={"swe_min": {"dtype": "float32", "zlib": True, "complevel": 4}},
        )
        cache.close()

    return grid


def build_common_mask(
    registry: dict,
    interim_dir: Path,
    out_path: Path,
    raw_root: Path | None = None,
    swe_threshold: float = PERMANENT_SNOW_MIN_SWE,
) -> xr.Dataset:
    """Common land mask = GLDAS coverage AND IMERG coverage AND no permanent ice.

    A cell is inside the domain when

    - every **GLDAS** core registry variable has a valid value in >= 80 % of
      the 288 months (GLDAS is land-only, 60°S–90°N, so this excludes ocean
      and Antarctica);
    - IMERG has valid 1° coverage in >= 80 % of the months, where a month
      counts as covered when ``valid_fraction >= COARSE_VALID_AREA_FRACTION``
      (the same rule that made the harmonized value valid); and
    - the cell's minimum monthly SWE over 2001-2024 does not exceed
      ``swe_threshold`` (P08 T1: GLDAS has no glacier/ice-sheet model, so
      permanent snow/ice accumulates indefinitely).

    Records how many cells each criterion removes. Outside this mask, downstream
    layers are NaN / -99 (contract §1).
    """
    lat, lon = target_grid()
    n_months = contract.N_MONTHS
    min_months = int(COMMON_MASK_MIN_MONTH_FRACTION * n_months)
    raw_root = Path(raw_root) if raw_root is not None else PROJECT_ROOT / "data" / "raw"

    gldas_ok = xr.DataArray(
        np.ones((contract.N_ROWS, contract.N_COLS), dtype=bool),
        dims=("lat", "lon"),
        coords={"lat": lat, "lon": lon},
    )
    gldas_per_variable: dict[str, int] = {}
    for variable in registry["variables"]:
        if variable["product"] != "GLDAS_NOAH10_M" or not variable.get("core"):
            continue
        cube = xr.open_dataset(interim_dir / f"{variable['id']}.nc")
        try:
            valid = cube[variable["id"]].notnull()
            ok = valid.sum("time") >= min_months
            gldas_per_variable[variable["id"]] = int(ok.sum())
            gldas_ok = gldas_ok & ok
        finally:
            cube.close()

    # IMERG coverage from the precipitation cube's valid_fraction companion.
    precip_cube = xr.open_dataset(interim_dir / "precipitation.nc")
    try:
        covered = (
            precip_cube["valid_fraction"] >= COARSE_VALID_AREA_FRACTION
        )
        imerg_ok = covered.sum("time") >= min_months
    finally:
        precip_cube.close()

    # P08 T1: permanent snow/ice (Greenland, high Arctic, some glaciers).
    swe_min = compute_min_swe(raw_root, interim_dir / SWE_CACHE_NAME)
    swe_excluded = swe_exclusion_mask(swe_min, swe_threshold)

    base_domain = gldas_ok & imerg_ok
    common = base_domain & ~swe_excluded

    n_gldas_removed = int((~gldas_ok).sum())
    n_imerg_removed = int((~imerg_ok).sum())
    n_swe_removed = int((base_domain & swe_excluded).sum())
    n_common = int(common.sum())
    mask = xr.Dataset(
        {
            "common_mask": xr.DataArray(
                common.astype(np.int8),
                dims=("lat", "lon"),
                coords={"lat": lat, "lon": lon},
                attrs={
                    "long_name": "Common land mask (contract domain)",
                    "flag_values": [0, 1],
                    "flag_meanings": "outside_domain inside_domain",
                },
            ),
            "swe_min": xr.DataArray(
                swe_min.astype(np.float32),
                dims=("lat", "lon"),
                coords={"lat": lat, "lon": lon},
                attrs={
                    "units": "kg m-2",
                    "long_name": "Minimum monthly SWE, 2001-2024 (diagnostic)",
                },
            ),
        },
        attrs={
            "title": "EarthPulse common land mask",
            "criteria": (
                "GLDAS core variables valid in >= 80% of months AND IMERG "
                "1° coverage (valid_fraction >= "
                f"{COARSE_VALID_AREA_FRACTION}) in >= 80% of months AND "
                f"minimum monthly SWE <= {swe_threshold:g} kg m-2"
            ),
            "gldas_core_variables": ",".join(gldas_per_variable),
            "min_valid_months": min_months,
            "n_months": n_months,
            "n_cells_total": contract.N_ROWS * contract.N_COLS,
            "n_cells_gldas_ok": n_common + n_imerg_removed + n_swe_removed,
            "n_cells_removed_by_gldas": n_gldas_removed,
            "n_cells_removed_by_imerg": n_imerg_removed,
            "n_cells_removed_by_swe": n_swe_removed,
            "n_cells_before_swe": int(base_domain.sum()),
            "n_cells_removed_total": int((~common).sum()),
            "n_cells_common": n_common,
            "swe_min_threshold_kg_m2": float(swe_threshold),
            "swe_rule": (
                "exclude when the cell minimum of monthly SWE_inst over "
                "2001-2024 exceeds the threshold (snow/ice never melts)"
            ),
            "package": "P02 + P08",
        },
    )
    # n_cells passing GLDAS only (before the IMERG/SWE criteria):
    mask.attrs["n_cells_gldas_ok"] = int(gldas_ok.sum())
    out_path.parent.mkdir(parents=True, exist_ok=True)
    mask.to_netcdf(
        out_path,
        engine="netcdf4",
        encoding={
            "common_mask": {"dtype": "int8", "zlib": True, "complevel": 4},
            "swe_min": {"dtype": "float32", "zlib": True, "complevel": 4},
        },
    )
    return mask


def verify_raw_coverage(raw_root: Path, registry: dict) -> dict[str, list[str]]:
    """Check that every product month exists on disk before harmonizing.

    Returns ``{product: [missing month labels]}``; gaps are reported and
    never filled (P02 spec T1).
    """
    missing: dict[str, list[str]] = {}
    products = sorted({v["product"] for v in registry["variables"]})
    for product in products:
        gaps = []
        for year, month in expected_months():
            directory = raw_root / RAW_SUBDIRS[product]
            matches = list(
                directory.glob(raw_file_pattern(product, year, month))
            )
            if len(matches) != 1:
                gaps.append(f"{year:04d}-{month:02d}")
        missing[product] = gaps
    return missing
