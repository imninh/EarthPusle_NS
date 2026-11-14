#!/usr/bin/env python
"""G1 acceptance: the existing seven variables must be byte-identical to a reference tree.

    .venv/Scripts/python scripts/g1_compare.py [new_dir] [reference_dir]

Defaults: data/export/web_data against web/public/data. Compares (a) every file under
grids/{old variable}/, series/climatology, series/tiles, series/regions/*/{old variable}.json
byte for byte, (b) screener rows of the old variables serialised identically per row,
(c) patterns/, correlations/, regions.json, regions/ byte for byte. Exit 1 on any difference.
``cases.json`` is a P06 selection over every verified variable, so the four pilot rows can
legitimately change it; it is not part of the G1 acceptance set and is not compared.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NEW = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "export" / "web_data"
REF = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "web" / "public" / "data"


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    old = [v["id"] for v in json.loads((REF / "index.json").read_text(encoding="utf-8"))["variables"]]
    print(f"reference variables ({len(old)}): {old}")
    grid_files = sum(
        1
        for vid in old
        for path in (REF / "grids" / vid).rglob("*")
        if path.is_file()
    )
    files = 0
    bad: list[str] = []

    def check(rel: Path) -> None:
        nonlocal files
        files += 1
        a, b = NEW / rel, REF / rel
        if not a.is_file() or not b.is_file() or sha(a) != sha(b):
            bad.append(str(rel).replace("\\", "/"))

    for vid in old:
        for sub in ("grids", "series/climatology", "series/tiles"):
            base = REF / sub / vid if sub != "series/climatology" else None
            if sub == "series/climatology":
                check(Path(sub) / f"{vid}.f32")
                continue
            for p in sorted(base.rglob("*")):
                if p.is_file():
                    check(p.relative_to(REF))
        for p in sorted((REF / "series" / "regions").glob(f"*/{vid}.json")):
            check(p.relative_to(REF))
    for sub in ("patterns", "correlations", "regions"):
        for p in sorted((REF / sub).rglob("*")):
            if p.is_file():
                check(p.relative_to(REF))
    check(Path("regions.json"))

    rows_checked = 0
    for p in sorted((REF / "screener").rglob("*.json")):
        rel = p.relative_to(REF)
        ref_rows = {r["variable"]: r for r in json.loads(p.read_text(encoding="utf-8"))["rows"]}
        new_rows = {r["variable"]: r for r in json.loads((NEW / rel).read_text(encoding="utf-8"))["rows"]}
        for vid in old:
            rows_checked += 1
            if json.dumps(ref_rows[vid], sort_keys=False) != json.dumps(new_rows[vid], sort_keys=False):
                bad.append(f"{str(rel)}#{vid}")
    print(
        f"byte-compared files: {files} (old-variable grid files: {grid_files}); "
        f"screener rows compared: {rows_checked}"
    )
    if bad:
        print(f"DIFFERENT ({len(bad)}):")
        for item in bad[:40]:
            print("  -", item)
        return 1
    print("IDENTICAL: every compared file and screener row matches the reference")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
