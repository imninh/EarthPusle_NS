#!/usr/bin/env python
"""P08 T1: before/after common-mask quick-look and count summary.

Usage:
    .venv/Scripts/python scripts/p08_mask.py \
        --before data/interim/harmonized_monthly/common_mask_pre_p08.nc \
        --after data/interim/harmonized_monthly/common_mask.nc \
        --out data/interim/harmonized_monthly/p08_mask_before_after.png
"""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import xarray as xr  # noqa: E402


def _mask(path: Path) -> np.ndarray:
    with xr.open_dataset(path, engine="netcdf4") as ds:
        values = np.asarray(ds["common_mask"].values)
    return values.astype(bool)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--before",
        type=Path,
        default=Path("data/interim/harmonized_monthly/common_mask_pre_p08.nc"),
    )
    parser.add_argument(
        "--after",
        type=Path,
        default=Path("data/interim/harmonized_monthly/common_mask.nc"),
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("data/interim/harmonized_monthly/p08_mask_before_after.png"),
    )
    args = parser.parse_args()

    before = _mask(args.before)
    after = _mask(args.after)
    removed = before & ~after
    added = ~before & after
    print(f"before: {int(before.sum())} cells")
    print(f"after:  {int(after.sum())} cells")
    print(f"removed: {int(removed.sum())}; added: {int(added.sum())}")

    figure, axes = plt.subplots(1, 3, figsize=(16, 4.5), constrained_layout=True)
    extent = [-180, 180, -90, 90]
    panels = [
        (before, "Before P08 mask", "Greys"),
        (after, "After P08 mask (SWE > 10 kg m-2 removed)", "Greys"),
        (removed, "Removed cells (permanent snow/ice)", "Reds"),
    ]
    for axis, (field, title, cmap) in zip(axes, panels):
        image = axis.imshow(
            field.astype(float),
            origin="upper",
            extent=extent,
            cmap=cmap,
            vmin=0,
            vmax=1,
            aspect="auto",
        )
        axis.set_title(title)
        axis.set_xlabel("Longitude (degrees_east)")
        axis.set_ylabel("Latitude (degrees_north)")
        figure.colorbar(image, ax=axis, shrink=0.7)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(args.out, dpi=130)
    plt.close(figure)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
