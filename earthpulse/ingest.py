"""Reusable ingestion and metadata-inspection helpers for EarthPulse.

P01 scope: find, download and read one real monthly file from each NASA
product, then extract verified facts (names, units, dimensions, fill values
and time semantics). There is deliberately no regridding, no anomaly or
trend analysis and no science-result logic here.

Credentials are read by :mod:`earthaccess` from the user's netrc file. This
module never asks for, prints or stores a password or token.
"""

from __future__ import annotations

import calendar
import hashlib
import math
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlparse

import cftime
import numpy as np
import xarray as xr
from cmr import GranuleQuery

try:
    import earthaccess
except ImportError as exc:  # pragma: no cover - import guard only
    raise ImportError(
        "earthaccess is required. Install the project with `uv pip install -e .`."
    ) from exc


# ---------------------------------------------------------------------------
# Product configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProductSpec:
    """Facts needed to find, download and open one NASA product.

    Attributes:
        short_name: CMR collection short name.
        version: CMR collection version string.
        label: Human-readable product label.
        raw_subdir: Sub-directory under the raw data root.
        sample_months: ``(year, month)`` samples requested for P01.
        open_group: HDF5 group to open, or ``None`` for the root group.
        expected_format: Expected container format from CMR metadata.
        source_type: ``model`` or ``mission_observation``.
        check_only: True when the product is inspected only to answer an
            existence/compatibility question.
    """

    short_name: str
    version: str
    label: str
    raw_subdir: str
    sample_months: tuple[tuple[int, int], ...]
    open_group: str | None = None
    expected_format: str = "netCDF4"
    source_type: str = "model"
    check_only: bool = False


SPECS: tuple[ProductSpec, ...] = (
    ProductSpec(
        short_name="GLDAS_NOAH025_M",
        version="2.1",
        label="GLDAS Noah Land Surface Model L4 monthly 0.25 x 0.25 degree V2.1",
        raw_subdir="gldas",
        sample_months=((2001, 1), (2024, 7)),
        source_type="model",
    ),
    ProductSpec(
        short_name="GPM_3IMERGM",
        version="07",
        label="GPM IMERG Final Precipitation L3 1 month 0.1 x 0.1 degree V07",
        raw_subdir="gpm",
        sample_months=((2001, 1), (2024, 7)),
        open_group="Grid",
        expected_format="HDF5",
        source_type="mission_observation",
    ),
    ProductSpec(
        short_name="GLDAS_NOAH10_M",
        version="2.1",
        label="GLDAS Noah Land Surface Model L4 monthly 1.0 x 1.0 degree V2.1",
        raw_subdir="gldas",
        sample_months=((2001, 1),),
        source_type="model",
        check_only=True,
    ),
)

SPECS_BY_SHORT_NAME: dict[str, ProductSpec] = {spec.short_name: spec for spec in SPECS}

ANALYSIS_START = "2001-01-01"
ANALYSIS_END = "2024-12-31"


# ---------------------------------------------------------------------------
# Authentication, collection and granule discovery
# ---------------------------------------------------------------------------


def login() -> None:
    """Authenticate with NASA Earthdata using the local netrc file.

    Raises:
        RuntimeError: If ``earthaccess`` cannot authenticate. The caller must
            stop and ask the user to create the netrc file; credentials must
            never be requested, printed or stored by this project.
    """

    if not earthaccess.login(strategy="netrc"):
        raise RuntimeError(
            "NASA Earthdata login failed. Create the credential file once with "
            "`.venv/Scripts/python -c \"import earthaccess; "
            "earthaccess.login(strategy='interactive', persist=True)\"` and re-run."
        )


def search_collection(spec: ProductSpec) -> Any:
    """Return the single CMR collection for ``spec``.

    Raises:
        LookupError: If the short name/version pair returns no collection.
        RuntimeError: If more than one collection matches.
    """

    collections = earthaccess.search_datasets(
        short_name=spec.short_name, version=spec.version
    )
    if not collections:
        raise LookupError(
            f"No CMR collection found for short_name={spec.short_name!r}, "
            f"version={spec.version!r}. Stop and report rather than substituting."
        )
    if len(collections) > 1:
        raise RuntimeError(
            f"{len(collections)} collections found for {spec.short_name} "
            f"v{spec.version}; refusing to guess."
        )
    return collections[0]


def collection_record(spec: ProductSpec, access_date: str | None = None) -> dict[str, Any]:
    """Extract T1 collection-level facts from CMR for one product.

    Args:
        spec: Product to query.
        access_date: ISO date string; defaults to today.

    Returns:
        A JSON-serialisable dictionary with concept ID, version, DOI,
        temporal/spatial coverage and related URLs.
    """

    collection = search_collection(spec)
    umm: Mapping[str, Any] = collection["umm"]
    meta: Mapping[str, Any] = collection["meta"]

    temporal_start, temporal_end = _temporal_coverage(umm)
    spatial, resolution = _spatial_coverage(umm)
    urls = _related_urls(umm)

    doi = None
    if isinstance(umm.get("DOI"), Mapping):
        doi = umm["DOI"].get("DOI")

    documentation_url = next(
        (u["URL"] for u in urls if "disc.gsfc.nasa.gov/datacollection/" in u["URL"]),
        None,
    )
    if documentation_url is None:
        documentation_url = next(
            (u["URL"] for u in urls if u["URL"].startswith("https://")), None
        )

    return {
        "short_name": spec.short_name,
        "version": spec.version,
        "label": spec.label,
        "concept_id": meta.get("concept-id"),
        "doi": doi,
        "title": umm.get("EntryTitle"),
        "temporal_coverage": {"start": temporal_start, "end": temporal_end},
        "spatial_extent": spatial,
        "resolution_deg": resolution,
        "documentation_url": documentation_url,
        "related_urls": urls,
        "source_type": spec.source_type,
        "check_only": spec.check_only,
        "access_date": access_date or date.today().isoformat(),
    }


def granule_count(concept_id: str, start: str = ANALYSIS_START, end: str = ANALYSIS_END) -> int:
    """Return the CMR granule count for a collection in an inclusive date range."""

    query = (
        GranuleQuery()
        .collection_concept_id(concept_id)
        .temporal(f"{start}T00:00:00Z", f"{end}T23:59:59Z")
    )
    return int(query.hits())


def search_sample_granules(
    spec: ProductSpec, year: int, month: int
) -> list[Any]:
    """Search the single monthly granule for ``spec`` in ``year``/``month``.

    Raises:
        RuntimeError: If the result is not exactly one granule, so that a
            silent month/version substitution cannot happen.
    """

    last_day = calendar.monthrange(year, month)[1]
    granules = earthaccess.search_data(
        short_name=spec.short_name,
        version=spec.version,
        temporal=(
            f"{year}-{month:02d}-01",
            f"{year}-{month:02d}-{last_day:02d}",
        ),
    )
    if len(granules) != 1:
        raise RuntimeError(
            f"Expected exactly one {spec.short_name} granule for "
            f"{year}-{month:02d}, found {len(granules)}. Stop for review."
        )
    return granules


def granule_record(granule: Any) -> dict[str, Any]:
    """Return the granule identity, file name, size and an HTTPS download URL."""

    meta = granule.get("meta", {})
    links = [str(link) for link in granule.data_links()]
    https_links = [link for link in links if link.startswith("https://")]
    preferred = [link for link in https_links if "gesdisc" in link]
    url = (preferred or https_links or links or [None])[0]
    if url is None:
        raise RuntimeError(f"No download URL found for granule {meta.get('native-id')}")

    # CMR native-id is "<collection>:<file>"; the URL basename is the actual
    # file name and is safe on Windows (native-id may contain a colon).
    file_name = Path(urlparse(url).path).name
    if not file_name:
        raise RuntimeError(f"Could not derive a file name from URL {url}")

    size_mb = getattr(granule, "size", None)
    return {
        "granule_name": file_name,
        "granule_id": meta.get("native-id"),
        "granule_url": url,
        "size_mb": float(size_mb) if size_mb is not None else None,
    }


def download_granule(
    spec: ProductSpec,
    granule: Any,
    raw_root: Path,
    expected_sha256: str | None = None,
) -> dict[str, Any]:
    """Download one granule, or reuse an existing file after checksum verification.

    Args:
        spec: Product the granule belongs to.
        granule: ``earthaccess`` granule object.
        raw_root: Root of the git-ignored raw-data tree.
        expected_sha256: Checksum recorded by a previous run, if any.

    Returns:
        Sample record with file name, path, size, URL and SHA-256.

    Raises:
        RuntimeError: If an existing file's checksum does not match the
            previously recorded checksum. Files are never silently overwritten.
    """

    record = granule_record(granule)
    destination = raw_root / spec.raw_subdir / str(record["granule_name"])
    destination.parent.mkdir(parents=True, exist_ok=True)

    if destination.exists():
        actual = sha256_file(destination)
        if expected_sha256 and actual != expected_sha256:
            raise RuntimeError(
                f"Checksum mismatch for existing file {destination}: "
                f"expected {expected_sha256}, got {actual}. Refusing to overwrite; "
                "inspect or remove the file manually."
            )
        status = "reused"
    else:
        downloaded = earthaccess.download(
            [granule], local_path=str(destination.parent), show_progress=False
        )
        if not downloaded:
            raise RuntimeError(f"earthaccess.download returned no path for {destination.name}")
        produced = Path(downloaded[0])
        if produced.resolve() != destination.resolve():
            # earthaccess normally preserves the granule name.
            if produced.exists():
                produced.replace(destination)
        actual = sha256_file(destination)
        status = "downloaded"

    return {
        "file": destination.name,
        "path": destination.as_posix(),
        "granule_name": record["granule_name"],
        "granule_url": record["granule_url"],
        "size_bytes": int(destination.stat().st_size),
        "sha256": actual,
        "checksum_verified": bool(expected_sha256) and actual == expected_sha256,
        "download_status": status,
    }


def sha256_file(path: Path, chunk_size: int = 1 << 20) -> str:
    """Return the SHA-256 hex digest of a file."""

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


# ---------------------------------------------------------------------------
# File opening and structural inspection
# ---------------------------------------------------------------------------


def open_product(path: Path | str, spec: ProductSpec) -> xr.Dataset:
    """Open a product file with the settings recorded in the manifest.

    ``mask_and_scale=False`` keeps the raw stored values and ``_FillValue``
    attributes visible for metadata inspection; ``decode_times=False`` keeps
    the raw time value available alongside the decoded one.

    For a product stored in an HDF5 subgroup (IMERG), the root-level
    attributes are copied onto the returned dataset so that provenance fields
    such as ``FileHeader`` remain available; group attributes are kept as-is
    and take precedence.
    """

    dataset = xr.open_dataset(
        path,
        engine="netcdf4",
        group=spec.open_group,
        decode_times=False,
        mask_and_scale=False,
    )
    if spec.open_group is not None:
        root = xr.open_dataset(
            path,
            engine="netcdf4",
            decode_times=False,
            mask_and_scale=False,
        )
        try:
            for key, value in root.attrs.items():
                dataset.attrs.setdefault(key, value)
        finally:
            root.close()
    return dataset


def attribute(obj: Any, *names: str) -> Any:
    """Return the first matching attribute, case-insensitively.

    Product files are inconsistent about attribute case (for example IMERG
    stores both ``Units`` and ``units``), so matching is deliberately
    tolerant while preferring the caller's spelling.
    """

    attrs = getattr(obj, "attrs", {})
    for name in names:
        if name in attrs:
            return attrs[name]
    lowered = {str(key).lower(): value for key, value in attrs.items()}
    for name in names:
        value = lowered.get(name.lower())
        if value is not None:
            return value
    return None


def parse_pvl(text: Any) -> dict[str, str]:
    """Parse a GPM ``Key=Value;`` metadata string into a dictionary."""

    parsed: dict[str, str] = {}
    if text is None:
        return parsed
    for part in str(text).replace("\n", " ").split(";"):
        if "=" in part:
            key, value = part.split("=", 1)
            parsed[key.strip()] = value.strip()
    return parsed


def inspection_record(ds: xr.Dataset, spec: ProductSpec) -> dict[str, Any]:
    """Collect T3 file-level facts for one open dataset."""

    dimensions = {str(name): int(size) for name, size in ds.sizes.items()}
    data_names = data_variable_names(ds)
    dimension_order = list(ds[data_names[0]].dims) if data_names else []

    grid = grid_metadata(ds, spec)
    time = time_metadata(ds)

    global_attrs: dict[str, Any] = {}
    wanted = [
        "Conventions",
        "title",
        "source",
        "institution",
        "references",
        "comment",
        "history",
        "MAP_PROJECTION",
        "DX",
        "DY",
        "SOUTH_WEST_CORNER_LAT",
        "SOUTH_WEST_CORNER_LON",
        "tavg definision:",
        "acc definision:",
        "inst definision:",
        "FileHeader",
        "FileInfo",
        "GridHeader",
    ]
    for key in wanted:
        if key in ds.attrs:
            global_attrs[key] = _jsonable(ds.attrs[key])

    return {
        "file_format": spec.expected_format,
        "netcdf_data_model": "NETCDF4",
        "disk_format": "HDF5",
        "open_with": {"engine": "netcdf4", "group": spec.open_group},
        "dimensions": dimensions,
        "dimension_order": dimension_order,
        "coordinates": {
            "names": [grid["lat_name"], grid["lon_name"], "time"],
            "lat": {
                "name": grid["lat_name"],
                "units": grid["lat_units"],
                "long_name": grid["lat_long_name"],
                "size": len(ds[grid["lat_name"]]),
            },
            "lon": {
                "name": grid["lon_name"],
                "units": grid["lon_units"],
                "long_name": grid["lon_long_name"],
                "size": len(ds[grid["lon_name"]]),
            },
        },
        "grid": grid,
        "time": time,
        "global_attributes": global_attrs,
    }


def grid_metadata(ds: xr.Dataset, spec: ProductSpec) -> dict[str, Any]:
    """Return coordinate order, orientation, spacing and extent facts."""

    lat = np.asarray(ds["lat"].values, dtype=float)
    lon = np.asarray(ds["lon"].values, dtype=float)
    if lat.ndim != 1 or lon.ndim != 1:
        raise ValueError("Expected one-dimensional latitude and longitude coordinates")

    lat_diff = np.diff(lat)
    lon_diff = np.diff(lon)
    if not (np.all(lat_diff > 0) or np.all(lat_diff < 0)):
        raise ValueError("Latitude coordinate is not monotonic")
    if not (np.all(lon_diff > 0) or np.all(lon_diff < 0)):
        raise ValueError("Longitude coordinate is not monotonic")

    lat_order = "ascending" if lat_diff[0] > 0 else "descending"
    lon_order = "ascending" if lon_diff[0] > 0 else "descending"
    measured_lat_resolution = float(np.median(np.abs(lat_diff)))
    measured_lon_resolution = float(np.median(np.abs(lon_diff)))
    lon_range = "-180..180" if float(lon.min()) < 0 else "0..360"

    cell_registration: str | None
    grid_origin: str | None
    registration_evidence: str
    stated_lat_resolution: float | None = None
    stated_lon_resolution: float | None = None
    if spec.open_group == "Grid":
        header = parse_pvl(ds.attrs.get("GridHeader"))
        cell_registration = (header.get("Registration") or "").lower() or None
        grid_origin = (header.get("Origin") or "").lower() or None
        registration_evidence = (
            f"GridHeader: Registration={cell_registration}; "
            f"LatitudeResolution={header.get('LatitudeResolution')}; "
            f"LongitudeResolution={header.get('LongitudeResolution')}; "
            f"Origin={grid_origin}"
        )
        try:
            stated_lat_resolution = float(header["LatitudeResolution"])
            stated_lon_resolution = float(header["LongitudeResolution"])
        except (KeyError, TypeError, ValueError):
            pass
    else:
        # GLDAS files do not state the centre/edge convention explicitly. The
        # coordinate values and CMR bounding box imply cell centres.
        cell_registration = "center (inferred; not explicitly stated in file)"
        grid_origin = None
        registration_evidence = (
            "MAP_PROJECTION=EQUIDISTANT CYLINDRICAL; "
            f"DX={ds.attrs.get('DX')}; DY={ds.attrs.get('DY')}; "
            f"SOUTH_WEST_CORNER_LAT={ds.attrs.get('SOUTH_WEST_CORNER_LAT')}; "
            f"SOUTH_WEST_CORNER_LON={ds.attrs.get('SOUTH_WEST_CORNER_LON')}; "
            "first coordinate value equals the named corner value while CMR "
            "gives the outer bounding box, so coordinate arrays are cell centres"
        )
        try:
            stated_lat_resolution = float(ds.attrs["DY"])
            stated_lon_resolution = float(ds.attrs["DX"])
        except (KeyError, TypeError, ValueError):
            pass

    lat_resolution = (
        stated_lat_resolution
        if stated_lat_resolution is not None
        else measured_lat_resolution
    )
    lon_resolution = (
        stated_lon_resolution
        if stated_lon_resolution is not None
        else measured_lon_resolution
    )
    resolution_source = (
        "file attribute"
        if stated_lat_resolution is not None and stated_lon_resolution is not None
        else "measured from coordinate arrays"
    )

    data_names = data_variable_names(ds)
    dimension_order = list(ds[data_names[0]].dims) if data_names else []

    return {
        "lat_name": "lat",
        "lon_name": "lon",
        "lat_units": attribute(ds["lat"], "units"),
        "lon_units": attribute(ds["lon"], "units"),
        "lat_long_name": attribute(ds["lat"], "long_name", "LongName"),
        "lon_long_name": attribute(ds["lon"], "long_name", "LongName"),
        "dimension_order": dimension_order,
        "lat_order": lat_order,
        "lon_order": lon_order,
        "lon_range": lon_range,
        "resolution_deg": round((lat_resolution + lon_resolution) / 2.0, 6),
        "lat_resolution_deg": round(lat_resolution, 6),
        "lon_resolution_deg": round(lon_resolution, 6),
        "resolution_source": resolution_source,
        "measured_lat_spacing_deg": round(measured_lat_resolution, 6),
        "measured_lon_spacing_deg": round(measured_lon_resolution, 6),
        "lat_extent": [float(lat.min()), float(lat.max())],
        "lon_extent": [float(lon.min()), float(lon.max())],
        "cell_registration": cell_registration,
        "grid_origin": grid_origin,
        "registration_evidence": registration_evidence,
    }


def time_metadata(ds: xr.Dataset) -> dict[str, Any]:
    """Return raw, decoded and bounds-based time facts for a monthly file."""

    time_var = ds["time"]
    raw = float(np.asarray(time_var.values).ravel()[0])
    units = attribute(time_var, "units")
    calendar_name = attribute(time_var, "calendar") or "standard"
    if units is None:
        raise ValueError("Time coordinate has no units attribute")

    decoded = cftime.num2date(raw, units, calendar=calendar_name)
    result: dict[str, Any] = {
        "raw": raw,
        "units": units,
        "calendar": calendar_name,
        "decoded": decoded.isoformat(),
        "represents": "unknown",
        "bounds": None,
    }

    if "time_bnds" in ds:
        bounds_values = np.asarray(ds["time_bnds"].values).ravel()
        if bounds_values.size >= 2:
            start_raw = float(bounds_values[0])
            end_raw = float(bounds_values[1])
            start = cftime.num2date(start_raw, units, calendar=calendar_name)
            end = cftime.num2date(end_raw, units, calendar=calendar_name)
            result["bounds"] = {
                "start_raw": start_raw,
                "end_raw": end_raw,
                "start": start.isoformat(),
                "end": end.isoformat(),
            }
            next_year = start.year + (1 if start.month == 12 else 0)
            next_month = 1 if start.month == 12 else start.month + 1
            starts_month = (
                start.day,
                start.hour,
                start.minute,
                start.second,
            ) == (1, 0, 0, 0)
            ends_next_month = (
                end.year,
                end.month,
                end.day,
                end.hour,
                end.minute,
                end.second,
            ) == (next_year, next_month, 1, 0, 0, 0)
            is_month_interval = starts_month and ends_next_month
            if is_month_interval and decoded == start:
                result["represents"] = (
                    "start of month (timestamp equals the start of a one-month "
                    "time_bnds interval)"
                )

    return result


def data_variable_names(ds: xr.Dataset) -> list[str]:
    """Return names of scientific data variables, excluding coordinates/bounds."""

    coordinate_names = {"time", "lat", "lon", "latitude", "longitude"}
    names: list[str] = []
    for name, variable in ds.variables.items():
        if name in coordinate_names:
            continue
        if name.endswith("_bnds") or name.endswith("_bounds"):
            continue
        names.append(str(name))
    return names


def variable_role(name: str, ds: xr.Dataset) -> str:
    """Classify a dataset variable as coordinate, bounds or data."""

    if name in {"time", "lat", "lon", "latitude", "longitude"}:
        return "coordinate"
    if name.endswith("_bnds") or name.endswith("_bounds"):
        return "bounds"
    return "data"


# ---------------------------------------------------------------------------
# Variable inventory and semantics
# ---------------------------------------------------------------------------


def temporal_semantics(
    spec: ProductSpec,
    name: str,
    attrs: Mapping[str, Any],
    global_attrs: Mapping[str, Any],
) -> tuple[str, str]:
    """Return ``(semantic_type, evidence_text)`` for one variable.

    ``semantic_type`` is one of ``state``, ``rate``, ``accumulation`` or
    ``unknown``. ``evidence_text`` quotes the attribute text that supports the
    answer; it is never inferred from a variable name alone.
    """

    cell_methods = attrs.get("cell_methods")
    units = attrs.get("units") or attrs.get("Units")

    if spec.short_name.startswith("GLDAS"):
        inst_definition = global_attrs.get("inst definision:")
        tavg_definition = global_attrs.get("tavg definision:")
        acc_definition = global_attrs.get("acc definision:")

        if name.endswith("_inst"):
            evidence = (
                f"name suffix '_inst'; global attribute 'inst definision: "
                f"{inst_definition}'; cell_methods='{cell_methods}'"
            )
            return "state", evidence
        if name.endswith("_tavg"):
            evidence = (
                f"name suffix '_tavg'; global attribute 'tavg definision: "
                f"{tavg_definition}'; cell_methods='{cell_methods}'"
            )
            return "rate", evidence
        if name.endswith("_acc"):
            evidence = (
                f"name suffix '_acc'; global attribute 'acc definision: "
                f"{acc_definition}'; cell_methods='{cell_methods}'"
            )
            return "accumulation", evidence
        return "unknown", f"cell_methods='{cell_methods}'"

    if spec.short_name == "GPM_3IMERGM" and name == "precipitation":
        header = parse_pvl(global_attrs.get("GridHeader"))
        file_header = parse_pvl(global_attrs.get("FileHeader"))
        evidence = (
            f"GridHeader BinMethod={header.get('BinMethod')}; "
            f"FileHeader TimeInterval={file_header.get('TimeInterval')}"
        )
        return "rate", evidence

    if units == "mm/hr":
        return "rate", f"Units='{units}'"
    return "unknown", f"Units='{units}'"


def inventory_rows(
    ds: xr.Dataset, spec: ProductSpec, sample_file: str
) -> list[dict[str, Any]]:
    """Build T4 rows for every variable in one open file."""

    global_attrs = ds.attrs
    rows: list[dict[str, Any]] = []
    for name, variable in ds.variables.items():
        role = variable_role(name, ds)
        semantic_type, evidence = temporal_semantics(
            spec, str(name), variable.attrs, global_attrs
        )
        rows.append(
            {
                "product": spec.short_name,
                "version": spec.version,
                "sample_file": sample_file,
                "variable": str(name),
                "role": role,
                "long_name": attribute(variable, "long_name", "LongName"),
                "standard_name": attribute(variable, "standard_name"),
                "units": attribute(variable, "units", "Units"),
                "dimensions": ",".join(str(dim) for dim in variable.dims),
                "dtype": str(variable.dtype),
                "fill_value": _jsonable(
                    attribute(variable, "_FillValue", "CodeMissingValue")
                ),
                "missing_value": _jsonable(
                    attribute(variable, "missing_value", "CodeMissingValue")
                ),
                "scale_factor": _jsonable(attribute(variable, "scale_factor")),
                "add_offset": _jsonable(attribute(variable, "add_offset")),
                "cell_methods": attribute(variable, "cell_methods"),
                "semantic_type": semantic_type,
                "semantics_evidence": evidence,
            }
        )
    return rows


# ---------------------------------------------------------------------------
# Sanity statistics
# ---------------------------------------------------------------------------


@dataclass
class SanityAccumulator:
    """Accumulate valid-value statistics without loading all samples at once."""

    total_cells: int = 0
    valid_cells: int = 0
    minimum: float = math.inf
    maximum: float = -math.inf
    total: float = 0.0

    def add(self, values: Any, fill_value: Any = None) -> None:
        """Add one array of stored values, excluding fill and non-finite cells."""

        array = np.asarray(values, dtype=np.float64).reshape(-1)
        finite = np.isfinite(array)
        if fill_value is not None:
            try:
                finite &= array != float(fill_value)
            except (TypeError, ValueError):
                pass
        valid = array[finite]

        self.total_cells += int(array.size)
        self.valid_cells += int(valid.size)
        if valid.size:
            self.minimum = min(self.minimum, float(valid.min()))
            self.maximum = max(self.maximum, float(valid.max()))
            self.total += float(valid.sum())

    def as_dict(self) -> dict[str, Any]:
        """Return the manifest ``sanity`` object."""

        if self.valid_cells:
            minimum: float | None = self.minimum
            maximum: float | None = self.maximum
            mean: float | None = self.total / self.valid_cells
        else:
            minimum = maximum = mean = None
        fill_fraction = (
            1.0 - (self.valid_cells / self.total_cells) if self.total_cells else None
        )
        return {
            "valid_cells": self.valid_cells,
            "total_cells": self.total_cells,
            "min": minimum,
            "max": maximum,
            "mean": mean,
            "fill_fraction": fill_fraction,
        }


def count_outside(
    values: Any,
    fill_value: Any,
    low: float | None = None,
    high: float | None = None,
) -> int:
    """Count valid values outside ``[low, high]`` (either bound may be None)."""

    array = np.asarray(values, dtype=np.float64).reshape(-1)
    finite = np.isfinite(array)
    if fill_value is not None:
        try:
            finite &= array != float(fill_value)
        except (TypeError, ValueError):
            pass
    valid = array[finite]
    outside = np.zeros(valid.shape, dtype=bool)
    if low is not None:
        outside |= valid < low
    if high is not None:
        outside |= valid > high
    return int(outside.sum())


# ---------------------------------------------------------------------------
# Quick-look maps
# ---------------------------------------------------------------------------


def quicklook_map(
    ds: xr.Dataset,
    variable: str,
    output_path: Path | str,
    title: str | None = None,
    fill_value: Any = None,
) -> Path:
    """Save a north-up quick-look map used only to catch orientation errors."""

    import matplotlib

    matplotlib.use("Agg", force=False)
    import matplotlib.pyplot as plt

    data = ds[variable].isel(time=0).transpose("lat", "lon").values.astype(float)
    if fill_value is None:
        fill_value = attribute(ds[variable], "_FillValue", "CodeMissingValue")
    if fill_value is not None:
        try:
            data[data == float(fill_value)] = np.nan
        except (TypeError, ValueError):
            pass
    data[~np.isfinite(data)] = np.nan

    lat = np.asarray(ds["lat"].values, dtype=float)
    lon = np.asarray(ds["lon"].values, dtype=float)
    lat_step = float(np.median(np.abs(np.diff(lat))))
    lon_step = float(np.median(np.abs(np.diff(lon))))

    finite = data[np.isfinite(data)]
    if finite.size:
        vmin, vmax = np.nanpercentile(finite, [2, 98])
        if not np.isfinite(vmin) or not np.isfinite(vmax) or vmin == vmax:
            vmin, vmax = float(finite.min()), float(finite.max())
    else:
        vmin, vmax = None, None

    figure, axis = plt.subplots(figsize=(10, 5), constrained_layout=True)
    image = axis.imshow(
        data,
        origin="lower",
        extent=[
            float(lon.min()) - lon_step / 2,
            float(lon.max()) + lon_step / 2,
            float(lat.min()) - lat_step / 2,
            float(lat.max()) + lat_step / 2,
        ],
        aspect="auto",
        cmap="viridis",
        vmin=vmin,
        vmax=vmax,
    )
    figure.colorbar(image, ax=axis, shrink=0.8, label=attribute(ds[variable], "units", "Units"))
    axis.set_title(title or variable)
    axis.set_xlabel("Longitude (degrees_east)")
    axis.set_ylabel("Latitude (degrees_north)")
    axis.set_xlim(-180, 180)
    axis.set_ylim(-90, 90)

    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(destination, dpi=120)
    plt.close(figure)
    return destination


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _temporal_coverage(umm: Mapping[str, Any]) -> tuple[str | None, str | None]:
    extents = umm.get("TemporalExtents") or []
    if not extents:
        return None, None
    extent = extents[0]
    ranges = extent.get("RangeDateTimes") or []
    if not ranges:
        return None, None
    first = ranges[0]
    return first.get("BeginningDateTime"), first.get("EndingDateTime")


def _spatial_coverage(
    umm: Mapping[str, Any],
) -> tuple[dict[str, float] | None, float | None]:
    spatial = None
    resolution = None
    try:
        domain = umm["SpatialExtent"]["HorizontalSpatialDomain"]
        rectangles = domain["Geometry"]["BoundingRectangles"]
        if rectangles:
            rect = rectangles[0]
            spatial = {
                "west": float(rect["WestBoundingCoordinate"]),
                "south": float(rect["SouthBoundingCoordinate"]),
                "east": float(rect["EastBoundingCoordinate"]),
                "north": float(rect["NorthBoundingCoordinate"]),
            }
        resolutions = (
            domain.get("ResolutionAndCoordinateSystem", {})
            .get("HorizontalDataResolution", {})
            .get("GriddedResolutions", [])
        )
        if resolutions:
            resolution = float(resolutions[0]["XDimension"])
    except (KeyError, TypeError, ValueError):
        pass
    return spatial, resolution


def _related_urls(umm: Mapping[str, Any]) -> list[dict[str, Any]]:
    urls: list[dict[str, Any]] = []
    for entry in umm.get("RelatedUrls") or []:
        url = entry.get("URL")
        if not url:
            continue
        urls.append(
            {
                "URL": url,
                "Type": entry.get("Type"),
                "Subtype": entry.get("Subtype"),
                "Description": entry.get("Description"),
            }
        )
    return urls


def _jsonable(value: Any) -> Any:
    """Convert numpy scalars/arrays and path objects to JSON-safe values."""

    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, np.generic):
        return _jsonable(value.item())
    if isinstance(value, np.ndarray):
        return [_jsonable(item) for item in value.tolist()]
    if isinstance(value, Path):
        return str(value)
    return value
