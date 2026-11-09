"""Write a complete SYNTHETIC dataset in the EarthPulse data contract layout.

Purpose: let UI packages develop before real results exist. Every JSON file carries
"synthetic": true and the UI shows a banner. Values are smooth random fields, NOT NASA results.

The land mask comes from the GLDAS 1-degree sample downloaded by P01, if present,
so maps look realistic; otherwise a crude latitude band is used.

Usage: .venv/Scripts/python scripts/make_mock_data.py [--out web/public/data]
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np

from earthpulse import contract as C

ROOT = Path(__file__).resolve().parents[1]
GLDAS_1DEG_SAMPLE = ROOT / "data/raw/gldas/GLDAS_NOAH10_M.A200101.021.nc4"

# Provisional ids; the real list comes from the verified registry (P01b).
VARIABLES = [
    ("surface_skin_temperature", "Surface skin temperature", "temperature", "GLDAS_NOAH10_M",
     "model", "AvgSurfT_inst", "degC", True, "warmer"),
    ("root_zone_soil_moisture", "Root-zone soil moisture", "water", "GLDAS_NOAH10_M",
     "model", "RootMoist_inst", "kg m-2", True, "wetter"),
    ("precipitation", "Precipitation", "water", "GPM_3IMERGM",
     "mission_observation", "precipitation", "mm/month", True, "wetter"),
    ("air_temperature", "Near-surface air temperature", "temperature", "GLDAS_NOAH10_M",
     "model", "Tair_f_inst", "degC", False, "warmer"),
    ("surface_soil_moisture", "Surface soil moisture (0-10 cm)", "water", "GLDAS_NOAH10_M",
     "model", "SoilMoi0_10cm_inst", "kg m-2", False, "wetter"),
    ("evapotranspiration", "Evapotranspiration", "water", "GLDAS_NOAH10_M",
     "model", "Evap_tavg", "mm/month", False, "more evaporation"),
    ("specific_humidity", "Specific humidity", "atmosphere", "GLDAS_NOAH10_M",
     "model", "Qair_f_inst", "g kg-1", False, "more humid"),
]
BASE = {  # rough magnitudes for plausible-looking synthetic series
    "surface_skin_temperature": (15.0, 10.0, 0.03),
    "root_zone_soil_moisture": (300.0, 40.0, 0.5),
    "precipitation": (80.0, 40.0, 0.3),
    "air_temperature": (14.0, 9.0, 0.03),
    "surface_soil_moisture": (25.0, 5.0, 0.05),
    "evapotranspiration": (50.0, 25.0, 0.1),
    "specific_humidity": (8.0, 4.0, 0.01),
}
import yaml  # noqa: E402

# Regions come from the shared config (same source as the real export).
# Note: the mock's simple bbox test does not handle antimeridian-crossing boxes.
REGIONS = yaml.safe_load((ROOT / "config/regions.yaml").read_text(encoding="utf-8"))["regions"]
# Mock only writes cell tiles for these regions (real export writes all land tiles).
TILE_REGIONS = ("southeast_asia", "europe")

rng = np.random.default_rng(2026)
lats = np.array([C.row_to_lat(r) for r in range(C.N_ROWS)])
lons = np.array([C.col_to_lon(c) for c in range(C.N_COLS)])
LAT, LON = np.meshgrid(lats, lons, indexing="ij")
AREA_W = np.cos(np.deg2rad(LAT))


def land_mask() -> np.ndarray:
    if GLDAS_1DEG_SAMPLE.exists():
        import xarray as xr

        with xr.open_dataset(GLDAS_1DEG_SAMPLE, engine="netcdf4") as ds:
            v = ds["AvgSurfT_inst"].isel(time=0)
            v = v.sortby("lat", ascending=False).sortby("lon")
            arr = v.values
        full = np.zeros((C.N_ROWS, C.N_COLS), dtype=bool)
        r0 = C.lat_to_row(float(v["lat"].max()))
        full[r0 : r0 + arr.shape[0], :] = np.isfinite(arr)
        return full
    return (LAT > -55) & (LAT < 75) & (np.sin(np.deg2rad(LON) * 2) > -0.3)


def smooth_field(scale: float = 1.0) -> np.ndarray:
    f = np.zeros_like(LAT)
    for _ in range(6):
        kx, ky = rng.uniform(0.5, 3, 2)
        px, py = rng.uniform(0, 2 * np.pi, 2)
        f += rng.normal() * np.sin(np.deg2rad(LON) * kx + px) * np.cos(np.deg2rad(LAT) * ky + py)
    return scale * f / np.abs(f).max()


def write_json(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")


def write_bin(path: Path, arr: np.ndarray, dtype: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    np.ascontiguousarray(arr, dtype=np.dtype(dtype).newbyteorder("<")).tofile(path)


def months() -> list[str]:
    return [f"{y}-{m:02d}" for y in range(2001, 2025) for m in range(1, 13)]


def weighted_median(values: np.ndarray, weights: np.ndarray) -> float | None:
    if values.size == 0:
        return None
    order = np.argsort(values)
    cw = np.cumsum(weights[order])
    return float(values[order][np.searchsorted(cw, cw[-1] / 2)])


def main(out: Path) -> None:
    if out.exists():
        shutil.rmtree(out)
    mask = land_mask()
    mlist = months()
    t = np.arange(C.N_MONTHS)
    season = np.sin(2 * np.pi * (t % 12) / 12)

    trend_classes: dict[str, dict[str, np.ndarray]] = {}
    screener: dict[tuple[str, str], list[dict]] = {}

    for vid, *_rest in VARIABLES:
        mean, amp, slope_scale = BASE[vid]
        slope_field = smooth_field(slope_scale)  # per year
        noise_sd = np.abs(smooth_field(1.0)) * amp * 0.1 + amp * 0.05
        trend_classes[vid] = {}
        for wid, (start, end) in C.WINDOWS.items():
            n_months = mlist.index(end) - mlist.index(start) + 1
            slope = slope_field * (1 + 0.3 * rng.normal(size=LAT.shape))
            z = slope * 10 / (noise_sd + 1e-9) * np.sqrt(n_months / 288) * 10
            from scipy.stats import norm

            p = 2 * norm.sf(np.abs(z))
            p_orig = np.clip(p * 0.6, 0, 1)
            valid = mask & (rng.random(LAT.shape) > 0.01)
            pv = p[valid]
            order = np.argsort(pv)
            ranked = pv[order] * pv.size / (np.arange(pv.size) + 1)
            q_sorted = np.minimum.accumulate(ranked[::-1])[::-1].clip(0, 1)
            q = np.full(LAT.shape, np.nan)
            qv = np.empty_like(pv)
            qv[order] = q_sorted
            q[valid] = qv

            cls = np.full(LAT.shape, C.OUTSIDE_DOMAIN, dtype=np.int8)
            cls[mask] = C.INSUFFICIENT_DATA
            cls[valid] = C.TREND_NOT_SIGNIFICANT
            sig = valid & (q < C.Q_THRESHOLD)
            cls[sig & (slope > 0)] = C.TREND_INCREASE
            cls[sig & (slope < 0)] = C.TREND_DECREASE
            trend_classes[vid][wid] = cls

            std_change = slope * 10 / (noise_sd + 1e-9)
            layers = {
                "sen_slope": slope,
                "sen_slope_decade": slope * 10,
                "std_change_decade": std_change,
                "p_value": p,
                "p_value_original": p_orig,
                "q_value": q,
                "mk_tau": np.tanh(z / 5),
                "n_valid": np.full(LAT.shape, float(n_months)),
                "coverage": np.ones(LAT.shape),
            }
            for name, arr in layers.items():
                a = np.where(valid, arr, np.nan).astype(np.float32)
                write_bin(out / f"grids/{vid}/{wid}/{name}.f32", a, "f4")
            write_bin(out / f"grids/{vid}/{wid}/trend_class.i8", cls, "i1")

            domains = {"global": np.ones(LAT.shape, bool)}
            for reg in REGIONS:
                w_, s_, e_, n_ = reg["bbox"]
                domains[reg["id"]] = (LAT >= s_) & (LAT <= n_) & (LON >= w_) & (LON <= e_)
            for did, dmask in domains.items():
                dm = dmask & mask
                ev = dm & valid
                tot = AREA_W[dm].sum()
                evw = AREA_W[ev].sum() or 1.0
                up = float(AREA_W[ev & (cls == 1)].sum() / evw)
                down = float(AREA_W[ev & (cls == -1)].sum() / evw)
                sigm = ev & sig
                screener.setdefault((wid, did), []).append({
                    "variable": vid,
                    "valid_area_fraction": float(AREA_W[ev].sum() / tot) if tot else 0.0,
                    "sig_increase_area_fraction": up,
                    "sig_decrease_area_fraction": down,
                    "median_abs_std_change_decade": weighted_median(
                        np.abs(std_change[sigm]), AREA_W[sigm]),
                    "median_sen_slope_decade_sig": weighted_median(
                        slope[sigm] * 10, AREA_W[sigm]),
                    "regional_contrast": (min(up, down) / (up + down)) if up + down else None,
                    "n_cells_evaluated": int(ev.sum()),
                })

        # Time series: synthetic seasonal cycle + trend + noise.
        def cell_series(rows: np.ndarray, cols: np.ndarray) -> np.ndarray:
            base = mean + amp * season[:, None, None] * np.sign(LAT[rows][:, cols] + 1e-9)[None]
            trend = slope_field[rows][:, cols][None] * (t[:, None, None] / 12)
            noise = rng.normal(size=(C.N_MONTHS, rows.size, cols.size)) * noise_sd[rows][:, cols][None]
            return base + trend + noise

        tile_ids = set()
        climatology = np.full((12, C.N_ROWS, C.N_COLS), np.nan, dtype=np.float32)
        for reg in REGIONS:
            if reg["id"] not in TILE_REGIONS:
                continue
            w_, s_, e_, n_ = reg["bbox"]
            for r0 in range(C.lat_to_row(n_) // 10 * 10, C.lat_to_row(s_) + 1, 10):
                for c0 in range(C.lon_to_col(w_) // 10 * 10, C.lon_to_col(e_) + 1, 10):
                    rows, cols = np.arange(r0, r0 + 10), np.arange(c0, c0 + 10)
                    tmask = mask[np.ix_(rows, cols)]
                    if not tmask.any():
                        continue
                    vals = cell_series(rows, cols)
                    vals[:, ~tmask] = np.nan
                    clim = np.stack([vals[m:240:12].mean(axis=0) for m in range(12)])
                    anom = vals - clim[t % 12]
                    tid = f"r{r0:03d}_c{c0:03d}"
                    tile_ids.add(tid)
                    climatology[:, r0 : r0 + 10, c0 : c0 + 10] = clim
                    write_bin(out / f"series/tiles/{vid}/{tid}.anomalies.f32", anom, "f4")
        # Schema 1.1: values are reconstructed in the UI as anomaly + climatology.
        write_bin(out / f"series/climatology/{vid}.f32", climatology, "f4")

        for reg in REGIONS:
            w_, s_, e_, n_ = reg["bbox"]
            rows = np.arange(C.lat_to_row(n_), C.lat_to_row(s_) + 1)
            cols = np.arange(C.lon_to_col(w_), C.lon_to_col(e_) + 1)
            rmask = mask[np.ix_(rows, cols)]
            vals = cell_series(rows, cols)
            vals[:, ~rmask] = np.nan
            wts = np.where(rmask, AREA_W[np.ix_(rows, cols)], 0)
            series = np.nansum(vals * wts, axis=(1, 2)) / wts.sum()
            clim = np.array([series[m:240:12].mean() for m in range(12)])
            write_json(out / f"series/regions/{reg['id']}/{vid}.json", {
                "region": reg["id"], "variable": vid, "synthetic": True,
                "unit": next(v[6] for v in VARIABLES if v[0] == vid),
                "months": mlist,
                "values": [round(float(x), 4) for x in series],
                "anomalies": [round(float(x), 4) for x in series - clim[t % 12]],
                "valid_cell_fraction": [1.0] * C.N_MONTHS,
            })

    for (wid, did), rows in screener.items():
        write_json(out / f"screener/{wid}/{did}.json",
                   {"window": wid, "domain": did, "synthetic": True, "rows": rows})

    for wid in C.WINDOWS:
        tc = trend_classes["surface_skin_temperature"][wid]
        mc = trend_classes["root_zone_soil_moisture"][wid]
        pat = np.where(tc == C.OUTSIDE_DOMAIN, C.OUTSIDE_DOMAIN, C.INSUFFICIENT_DATA).astype(np.int8)
        both = (tc >= -1) & (mc >= -1)
        pat[both] = C.PATTERN_MIXED
        pat[(tc == 1) & (mc == -1)] = C.PATTERN_WARMING_DRYING
        pat[(tc == 1) & (mc == 1)] = C.PATTERN_WARMING_WETTING
        pat[(tc == -1) & (mc == -1)] = C.PATTERN_COOLING_DRYING
        pat[(tc == -1) & (mc == 1)] = C.PATTERN_COOLING_WETTING
        write_bin(out / f"patterns/{wid}/pattern_class.i8", pat, "i1")
        pair = "precipitation__root_zone_soil_moisture"
        r = np.where(mask, np.tanh(smooth_field(1.5) + 0.4), np.nan)
        for name, arr in {"r": r, "q": np.where(mask, rng.random(LAT.shape) * 0.2, np.nan),
                          "r_detrended": r * 0.9,
                          "q_detrended": np.where(mask, rng.random(LAT.shape) * 0.3, np.nan),
                          "n_pairs": np.where(mask, 280.0, np.nan)}.items():
            write_bin(out / f"correlations/{pair}/{wid}/{name}.f32", arr.astype(np.float32), "f4")

    write_json(out / "regions.json", {"synthetic": True, "regions": REGIONS})
    write_json(out / "cases.json", {
        "synthetic": True,
        "selection_method": "SYNTHETIC placeholder: no real selection performed.",
        "cases": [],
    })
    write_json(out / "index.json", {
        "schema_version": C.SCHEMA_VERSION,
        "generated_at": "synthetic",
        "synthetic": True,
        "grid": {"resolution_deg": C.RESOLUTION_DEG, "n_rows": C.N_ROWS, "n_cols": C.N_COLS,
                 "lat_north_center": C.LAT_NORTH_CENTER, "lon_west_center": C.LON_WEST_CENTER},
        "months": mlist,
        "baseline": list(C.BASELINE),
        "windows": [{"id": k, "start": s, "end": e} for k, (s, e) in C.WINDOWS.items()],
        "q_threshold": C.Q_THRESHOLD,
        "variables": [
            {"id": vid, "label": label, "category": cat, "product": prod,
             "product_version": "2.1" if prod.startswith("GLDAS") else "07", "doi": None,
             "source_type": st, "source_variable": sv, "display_unit": unit,
             "slope_unit": f"{unit} per year",
             "description": f"SYNTHETIC mock entry for {label.lower()}.",
             "caveats": ["Synthetic mock data for UI development. Not a NASA result."],
             "core": core, "increase_means": inc}
            for vid, label, cat, prod, st, sv, unit, core, inc in VARIABLES
        ],
        "pattern_pair": {"temperature": "surface_skin_temperature",
                         "moisture": "root_zone_soil_moisture"},
        "correlation_pairs": ["precipitation__root_zone_soil_moisture"],
        "layers": {"float": list(C.FLOAT_LAYERS), "class": list(C.CLASS_LAYERS)},
        "tiles": {"size": C.TILE_SIZE, "ids": sorted(tile_ids)},
    })
    print(f"Wrote synthetic dataset to {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=ROOT / "web/public/data")
    main(ap.parse_args().out)
