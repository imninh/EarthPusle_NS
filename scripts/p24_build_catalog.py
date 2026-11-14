#!/usr/bin/env python
"""P24 T1: turn the probe JSON into ``config/catalog.yaml``.

Rules are deterministic and documented in the output header. Labels and
descriptions are **drafts** derived from the file ``long_name``; the architect
must review them before P24 T5 publishes anything.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROBE = PROJECT_ROOT / "data" / "interim" / "catalog" / "probe_fields_with_validity.json"
OUT = PROJECT_ROOT / "config" / "catalog.yaml"

PILOT = {
    "T850": {
        "id": "air_temperature_850hpa",
        "label": "Air temperature at 850 hPa",
        "description": "Air temperature about 1.5 km above the surface, from the MERRA-2 reanalysis.",
        "category": "temperature",
        "increase_means": "warmer",
    },
    "T500": {
        "id": "air_temperature_500hpa",
        "label": "Air temperature at 500 hPa",
        "description": "Air temperature about 5.5 km above the surface, from the MERRA-2 reanalysis.",
        "category": "temperature",
        "increase_means": "warmer",
    },
    "TQV": {
        "id": "column_water_vapor",
        "label": "Column water vapour",
        "description": "All the water vapour in a column of air above each place, from the MERRA-2 reanalysis.",
        "category": "atmosphere",
        "increase_means": "more water vapour",
    },
    "TO3": {
        "id": "total_ozone",
        "label": "Total column ozone",
        "description": "Total ozone in a column of air above each place, from the MERRA-2 reanalysis.",
        "category": "atmosphere",
        "increase_means": "more ozone",
    },
}

NEAR_DUPLICATES = {
    "T10M": "Near-duplicate of T2M; keep the 2 m air temperature.",
    "QV10M": "Near-duplicate of QV2M; keep the 2 m specific humidity.",
    "U2M": "Near-duplicate 2 m wind level; keep U10M/V10M (10 m).",
    "U50M": "Near-duplicate 50 m wind level; keep U10M/V10M (10 m).",
    "V2M": "Near-duplicate 2 m wind level; keep U10M/V10M (10 m).",
    "V50M": "Near-duplicate 50 m wind level; keep U10M/V10M (10 m).",
    "TROPPT": "Near-duplicate tropopause estimate; keep the blended TROPPB.",
    "TROPPV": "Near-duplicate tropopause estimate; keep the blended TROPPB.",
}

EXTRA_EXCLUSIONS = {
    "SWE_inst": "Extreme values over Greenland; the registry already excludes it until a snow/ice QC rule exists.",
}

PRODUCT_LABEL = {
    "GLDAS_NOAH10_M": "GLDAS Noah land-surface model",
    "M2TMNXSLV": "MERRA-2 single-level reanalysis",
    "M2TMNXLND": "MERRA-2 land reanalysis",
}

HUMIDITY = {"QV2M", "Q250", "Q500", "Q850", "TQV", "TROPQ", "Qair_f_inst"}

# GLDAS layers share one long_name; make the depth part of the id and label.
GLDAS_DEPTH = {
    "SoilMoi0_10cm_inst": ("soil_moisture_0_10cm", "Soil moisture (0-10 cm)"),
    "SoilMoi10_40cm_inst": ("soil_moisture_10_40cm", "Soil moisture (10-40 cm)"),
    "SoilMoi40_100cm_inst": ("soil_moisture_40_100cm", "Soil moisture (40-100 cm)"),
    "SoilMoi100_200cm_inst": ("soil_moisture_100_200cm", "Soil moisture (100-200 cm)"),
    "SoilTMP0_10cm_inst": ("soil_temperature_0_10cm", "Soil temperature (0-10 cm)"),
    "SoilTMP10_40cm_inst": ("soil_temperature_10_40cm", "Soil temperature (10-40 cm)"),
    "SoilTMP40_100cm_inst": ("soil_temperature_40_100cm", "Soil temperature (40-100 cm)"),
    "SoilTMP100_200cm_inst": ("soil_temperature_100_200cm", "Soil temperature (100-200 cm)"),
}

OTHER_OVERRIDES = {
    "Qg_tavg": ("ground_heat_flux", "Ground heat flux"),
    "Psurf_f_inst": ("surface_pressure", "Surface pressure"),
    "Albedo_inst": ("surface_albedo", "Surface albedo"),
}

PRODUCT_SLUG = {
    "GLDAS_NOAH10_M": "gldas",
    "M2TMNXSLV": "merra2",
    "M2TMNXLND": "merra2_land",
}

# Editorial overrides where a long_name is too generic or an id would collide with a
# published variable. Keys are source_variable; these names are unique across the three files.
FIELD_OVERRIDES = {
    "T2M": ("air_temperature_2m", "Air temperature at 2 m", "temperature", "warmer"),
    "T2MDEW": ("dew_point_temperature_2m", "Dew-point temperature at 2 m", "temperature", "warmer"),
    "T2MWET": ("wet_bulb_temperature_2m", "Wet-bulb temperature at 2 m", "temperature", "warmer"),
    "TS": ("surface_skin_temperature_merra2", "Surface skin temperature (MERRA-2)", "temperature", "warmer"),
    "QV2M": ("specific_humidity_2m", "Specific humidity at 2 m", "atmosphere", "more humid"),
    "Q250": ("specific_humidity_250hpa", "Specific humidity at 250 hPa", "atmosphere", "more humid"),
    "Q500": ("specific_humidity_500hpa", "Specific humidity at 500 hPa", "atmosphere", "more humid"),
    "Q850": ("specific_humidity_850hpa", "Specific humidity at 850 hPa", "atmosphere", "more humid"),
    "T250": ("air_temperature_250hpa", "Air temperature at 250 hPa", "temperature", "warmer"),
    "U10M": ("eastward_wind_10m", "Eastward wind at 10 m", "wind", "stronger winds"),
    "V10M": ("northward_wind_10m", "Northward wind at 10 m", "wind", "stronger winds"),
    "U250": ("eastward_wind_250hpa", "Eastward wind at 250 hPa", "wind", "stronger winds"),
    "U500": ("eastward_wind_500hpa", "Eastward wind at 500 hPa", "wind", "stronger winds"),
    "U850": ("eastward_wind_850hpa", "Eastward wind at 850 hPa", "wind", "stronger winds"),
    "V250": ("northward_wind_250hpa", "Northward wind at 250 hPa", "wind", "stronger winds"),
    "V500": ("northward_wind_500hpa", "Northward wind at 500 hPa", "wind", "stronger winds"),
    "V850": ("northward_wind_850hpa", "Northward wind at 850 hPa", "wind", "stronger winds"),
    "H250": ("height_250hpa", "Geopotential height at 250 hPa", "atmosphere", "higher"),
    "H500": ("height_500hpa", "Geopotential height at 500 hPa", "atmosphere", "higher"),
    "H850": ("height_850hpa", "Geopotential height at 850 hPa", "atmosphere", "higher"),
    "H1000": ("height_1000hpa", "Geopotential height at 1000 hPa", "atmosphere", "higher"),
    "OMEGA500": ("vertical_velocity_500hpa", "Vertical velocity at 500 hPa", "atmosphere", "higher"),
    "PBLTOP": ("pbl_top_pressure", "Planetary boundary layer top pressure", "pressure", "higher pressure"),
    "CLDPRS": ("cloud_top_pressure", "Cloud-top pressure", "pressure", "higher pressure"),
    "CLDTMP": ("cloud_top_temperature", "Cloud-top temperature", "temperature", "warmer"),
    "TOX": ("total_column_odd_oxygen", "Total column odd oxygen", "atmosphere", "more odd oxygen"),
    "TQI": ("total_precipitable_ice_water", "Total precipitable ice water", "atmosphere", "more cloud water"),
    "TQL": ("total_precipitable_liquid_water", "Total precipitable liquid water", "atmosphere", "more cloud water"),
    "TROPPB": ("tropopause_pressure_blended", "Tropopause pressure (blended estimate)", "pressure", "higher pressure"),
    "TROPQ": ("tropopause_specific_humidity", "Tropopause specific humidity", "atmosphere", "more humid"),
    "TROPT": ("tropopause_temperature", "Tropopause temperature", "temperature", "warmer"),
    "FRSAT": ("fractional_area_saturated_zone", "Fractional area of the saturated zone", "water", "more saturated area"),
    "FRUNST": ("fractional_area_unsaturated_zone", "Fractional area of the unsaturated zone", "water", "more saturated area"),
    "FRWLT": ("fractional_area_wilting_zone", "Fractional area of the wilting zone", "water", "more saturated area"),
    "EVPSBLN": ("snow_ice_evaporation_energy_flux", "Snow and ice evaporation energy flux", "water", "more evaporation"),
    "SPSNOW": ("spurious_snow_energy_source", "Spurious snow energy source", "energy", "more energy"),
    "GWETPROF": ("average_profile_soil_wetness", "Average profile soil wetness", "water", "wetter"),
    "GWETROOT": ("root_zone_soil_wetness", "Root-zone soil wetness", "water", "wetter"),
    "GWETTOP": ("surface_soil_wetness", "Surface soil wetness", "water", "wetter"),
    "PRMC": ("water_profile_content", "Water content of the soil profile", "water", "wetter"),
    "RZMC": ("root_zone_water_content", "Root-zone water content", "water", "wetter"),
    "SFMC": ("surface_layer_water_content", "Surface-layer water content", "water", "wetter"),
}


def slug(text: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    value = re.sub(r"_+", "_", value)
    return value[:60].strip("_") or "variable"


def human_label(source: str, long_name: str | None) -> str:
    text = (long_name or source).replace("_", " ").strip()
    text = re.sub(r"\s+", " ", text)
    return text[:1].upper() + text[1:]


def category(field: dict[str, Any]) -> str:
    source = field["source_variable"]
    long = (field.get("long_name") or "").lower()
    units = field.get("units") or ""
    if source in PILOT:
        return PILOT[source]["category"]
    if source == "Albedo_inst" or "albedo" in long:
        return "energy"
    if "wind" in long or re.match(r"^[UV](2M|10M|50M|\d{3})$", source):
        return "wind"
    if "pressure" in long or units == "Pa" or source in {"PS", "SLP", "PBLTOP", "CLDPRS", "TROPPB", "TROPPT", "TROPPV"}:
        return "pressure"
    if "temperature" in long or units == "K" or source.startswith(("T2M", "T10M", "T250", "T500", "T850", "TS", "TSOIL", "TSURF", "TSAT", "TUNST", "TWLT", "TPSNOW", "CLDTMP")):
        return "temperature"
    if "snow" in long or source.startswith(("SNO", "SWE", "PRECSNO", "SMLAND", "SPSNOW", "SNDP")):
        return "snow"
    if "green" in long or source in {"LAI", "GRN"} or "vegetation" in long:
        return "vegetation"
    if any(word in long for word in ("evap", "transpir", "runoff", "baseflow", "infiltration", "precipitation", "rain")):
        return "water"
    if units in {"W m-2", "J m-2"} or any(word in long for word in ("radiation", "heat", "energy", "flux")):
        return "energy"
    if (
        units in {"kg m-2", "kg m-2 s-1", "m-3 m-3"}
        or any(word in long for word in ("water", "moisture", "wet", "humid", "canopy"))
        or source.startswith(("SoilMoi", "GWET", "PRMC", "RZMC", "SFMC", "TWLAND", "CanopInt", "WCHANGE", "QINFIL", "RUNOFF", "BASEFLOW", "EVAP", "PRECTOT", "RAIN"))
    ):
        return "water"
    return "atmosphere"


def increase_means(field: dict[str, Any], cat: str) -> str:
    source = field["source_variable"]
    long = (field.get("long_name") or "").lower()
    if source in PILOT:
        return PILOT[source]["increase_means"]
    if cat == "temperature":
        return "warmer"
    if cat == "wind":
        return "stronger winds"
    if cat == "snow":
        return "more snow"
    if cat == "vegetation":
        return "greener"
    if cat == "pressure":
        return "higher pressure"
    if cat == "energy":
        return "more energy"
    if cat == "water":
        if source in HUMIDITY or "humid" in long:
            return "more humid"
        if any(word in long for word in ("precip", "rain", "runoff", "baseflow", "infiltration")):
            return "more water"
        if any(word in long for word in ("evap", "transpir")):
            return "more evaporation"
        if any(word in long for word in ("moisture", "wet", "water", "canopy")):
            return "wetter"
        return "more water"
    if "ozone" in long:
        return "more ozone"
    if source in {"TQV"} or "vapour" in long or "vapor" in long:
        return "more water vapour"
    if "cloud" in long:
        return "more cloud"
    return "higher"


def display(field: dict[str, Any]) -> tuple[str, str]:
    units = field.get("units") or ""
    source = field["source_variable"]
    if source in PILOT:
        return ("degC", "kelvin_to_celsius") if units == "K" else (units or "1", "identity")
    if units == "K":
        return "degC", "kelvin_to_celsius"
    if units == "kg kg-1":
        return "g kg-1", "kg_per_kg_to_g_per_kg"
    if units == "kg m-2 s-1":
        return "mm/month", "per_second_to_per_month"
    if units == "Dobsons":
        return "DU", "identity"
    return units or "1", "identity"


def below_ground_pressure(source: str) -> int | None:
    """Pressure-level fields need masking where the surface is below that level."""
    match = re.match(r"^(?:[TQUVH]|OMEGA)(250|500|850|1000)$", source)
    return int(match.group(1)) if match else None


def exclusion_reason(field: dict[str, Any], share: float | None) -> str | None:
    source = field["source_variable"]
    if field.get("excluded_reason"):
        return field["excluded_reason"]
    if source in NEAR_DUPLICATES:
        return NEAR_DUPLICATES[source]
    if source in EXTRA_EXCLUSIONS:
        return EXTRA_EXCLUSIONS[source]
    if share is not None and share < 0.5 and source not in PILOT:
        return f"Only {share:.1%} of the common land mask is valid in at least 80% of sampled months (T4 rejects below 50%)."
    stats = field.get("stats") or {}
    if stats.get("n_finite") == 0:
        return "Field is entirely fill/undefined in the probe month."
    if stats.get("min") is not None and stats.get("min") == stats.get("max"):
        return "Field is constant in the probe month (categorical/constant field)."
    return None


def main() -> None:
    report = json.loads(PROBE.read_text(encoding="utf-8"))
    products = report["products"]
    records: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    used_ids: set[str] = set()

    for field in report["fields"]:
        share = field.get("valid_mask_share")
        reason = exclusion_reason(field, share)
        source = field["source_variable"]
        product = field["product"]
        pilot = PILOT.get(source)
        override = FIELD_OVERRIDES.get(source)
        if pilot:
            label = pilot["label"]
            proposed_id = pilot["id"]
            category_value = pilot["category"]
            increase_value = pilot["increase_means"]
        elif override:
            proposed_id, label, category_value, increase_value = override
        elif source in GLDAS_DEPTH:
            proposed_id, label = GLDAS_DEPTH[source]
            category_value = category(field)
            increase_value = increase_means(field, category_value)
        elif source in OTHER_OVERRIDES:
            proposed_id, label = OTHER_OVERRIDES[source]
            category_value = category(field)
            increase_value = increase_means(field, category_value)
        else:
            label = human_label(source, field.get("long_name"))
            proposed_id = slug(field.get("long_name") or source)
            category_value = category(field)
            increase_value = increase_means(field, category_value)
        if proposed_id in used_ids:
            base = f"{proposed_id}_{PRODUCT_SLUG.get(product, slug(product))}"
            proposed_id = base
            counter = 2
            while proposed_id in used_ids:
                proposed_id = f"{base}_{counter}"
                counter += 1
        used_ids.add(proposed_id)
        units = field.get("units") or "1"
        display_unit, conversion = display(field)
        item = {
            "id": proposed_id,
            "product": product,
            "source_variable": source,
            "label": label,
            "long_name": field.get("long_name") or source,
            "units": units,
            "native_grid": products[product]["native_grid"],
            "display_unit": display_unit,
            "conversion": conversion,
            "tier": "deep" if pilot else "catalog",
            "category": category_value,
            "increase_means": increase_value,
            "description": pilot["description"] if pilot else (
                f"Monthly {label.lower()} from the {PRODUCT_LABEL[product]}, on the common land grid."
            ),
            "valid_mask_share": None if share is None else round(float(share), 3),
            "month_stats": {
                key: (None if value is None else round(float(value), 6))
                for key, value in (field.get("stats") or {}).items()
                if key in {"min", "median", "max", "n_finite"}
            },
        }
        if reason:
            excluded.append(
                {
                    "product": product,
                    "source_variable": source,
                    "long_name": field.get("long_name") or source,
                    "units": units,
                    "reason": reason,
                    "valid_mask_share": None if share is None else round(float(share), 3),
                }
            )
        else:
            level = below_ground_pressure(source)
            if level is not None:
                item["mask_below_ground_hpa"] = level
            records.append(item)

    records.sort(key=lambda item: (item["product"], item["source_variable"]))
    excluded.sort(key=lambda item: (item["product"], item["source_variable"]))
    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "package": "P24 T1 probe (supersedes P23)",
        "method": (
            "Every field with a time dimension in one file per product was listed. Units, long_name "
            "and fill values are copied from the files. One-month statistics use 2001-01. "
            "valid_mask_share is the fraction of the 14,250-cell common land mask whose nearest "
            "native cell is finite in at least 80% of 48 sampled months (January and July of each "
            "year); production regridding is the P13 conservative overlap, not nearest sampling."
        ),
        "editorial": (
            "label and description are DRAFTS derived from long_name; review before P24 T5 publishes. "
            "No physical claim beyond the file attributes is made."
        ),
        "probe": {
            "month": report.get("month"),
            "validity_sample_months": report.get("validity_sample_months"),
            "validity_rule": ">= 80% of sampled months finite; threshold applied per 1 degree cell",
            "common_mask_cells": 14250,
        },
        "products": {
            name: {
                "version": products[name]["version"],
                "doi": products[name]["doi"],
                "source_type": products[name]["source_type"],
                "native_grid": products[name]["native_grid"],
                "n_lat": products[name]["n_lat"],
                "n_lon": products[name]["n_lon"],
            }
            for name in products
        },
        "counts": {
            "candidates": len(records),
            "excluded": len(excluded),
            "deep": len([item for item in records if item["tier"] == "deep"]),
            "catalog": len([item for item in records if item["tier"] == "catalog"]),
        },
        "fields": records,
        "excluded": excluded,
    }
    OUT.write_text(yaml.safe_dump(payload, sort_keys=False, allow_unicode=True, width=120), encoding="utf-8")
    print(f"wrote {OUT}: {len(records)} candidates, {len(excluded)} excluded")
    print("deep:", payload["counts"]["deep"], "catalog:", payload["counts"]["catalog"])


if __name__ == "__main__":
    main()
