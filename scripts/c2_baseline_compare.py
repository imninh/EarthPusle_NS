"""C2: compare the published significance rule with simpler ones.

Reads only the published export (web/public/data). Shares are cos(latitude)
area-weighted over the cells evaluated in the window (trend_class in -1, 0, 1).

Run from the repo root: .venv/Scripts/python scripts/c2_baseline_compare.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "public" / "data"
WINDOW = "2001-2024"
N_ROWS, N_COLS = 180, 360
LAT_NORTH_CENTER, RES = 89.5, 1.0
ALPHA = 0.05
TOL = 1e-6


def lat_weights() -> np.ndarray:
    rows = np.arange(N_ROWS, dtype=float)
    return np.cos(np.deg2rad(LAT_NORTH_CENTER - rows * RES))


def area_share(mask: np.ndarray, evaluated: np.ndarray) -> float:
    """Area-weighted share of the evaluated cells for which ``mask`` is true."""
    w = np.broadcast_to(lat_weights()[:, None], (N_ROWS, N_COLS))
    denom = float(w[evaluated].sum())
    if denom == 0.0:
        return float("nan")
    return float(w[evaluated & mask].sum()) / denom


def compute_shares(p_orig, p_hr, q, trend_class) -> dict[str, float]:
    evaluated = np.isin(trend_class, (-1, 0, 1))
    with np.errstate(invalid="ignore"):
        a = np.isfinite(p_orig) & (p_orig < ALPHA)
        b = np.isfinite(p_hr) & (p_hr < ALPHA)
        c = np.isfinite(q) & (q < ALPHA)
    return {
        "simple": area_share(a, evaluated),
        "autocorr": area_share(b, evaluated),
        "published": area_share(c, evaluated),
        "simple_not_published": area_share(a & ~c, evaluated),
    }


def _f32(path: Path) -> np.ndarray:
    return np.fromfile(path, dtype="<f4").reshape(N_ROWS, N_COLS)


def main() -> int:
    index = json.loads((DATA / "index.json").read_text(encoding="utf-8"))
    variables = [v["id"] if isinstance(v, dict) else v for v in index["variables"]]
    screener = json.loads(
        (DATA / "screener" / WINDOW / "global.json").read_text(encoding="utf-8")
    )
    rows = {r["variable"]: r for r in screener["rows"]}
    results, failed = {}, False
    for var in variables:
        d = DATA / "grids" / var / WINDOW
        tc = np.fromfile(d / "trend_class.i8", dtype="i1").reshape(N_ROWS, N_COLS)
        s = compute_shares(_f32(d / "p_value_original.f32"), _f32(d / "p_value.f32"),
                           _f32(d / "q_value.f32"), tc)
        r = rows[var]
        expected = r["sig_increase_area_fraction"] + r["sig_decrease_area_fraction"]
        s["screener"] = expected
        s["diff"] = s["published"] - expected
        if abs(s["diff"]) > TOL:
            failed = True
        results[var] = s
        print(f"{var}: simple={s['simple']:.6f} autocorr={s['autocorr']:.6f} "
              f"published={s['published']:.6f} simple_not_published="
              f"{s['simple_not_published']:.6f} screener={expected:.6f} diff={s['diff']:.2e}")
    if failed:
        print("MISMATCH: published share differs from screener by more than 1e-6")
        return 1
    print("OK: published share matches screener for all variables (1e-6)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
