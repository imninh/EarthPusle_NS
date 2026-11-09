# EarthPulse

**Evidence-first Earth system change detection.** EarthPulse turns 24 years of NASA
land-surface data into an explorable evidence trail: which variables are changing, where, how
much, and whether the change is statistically significant — with a visible warning when a
change looks like a data discontinuity rather than a climate trend.

Built for the NASA Space Apps Challenge 2026, challenge *Be An Earth System Trend Detective!*
(<https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/>).

> **Status (2026-11-09):** the app and pipeline work end to end on real data. The currently
> published export is schema **1.1**; the wave-2 re-run that adds the Greenland/snow-ice mask,
> data-quality layers, country domains and Detective Cases is in progress. Result figures in
> the docs are marked `TODO(after P08)` until that export is published.

## What it does

- **Screens variables.** Ranks seven land-surface variables by the area with a statistically
  significant trend, median standardized change, signed Sen slope and regional contrast.
- **Maps change.** Shows where a variable increases, decreases, is not significant, or has
  insufficient data; pattern classes expose opposite trends in the temperature/soil-moisture
  pair.
- **Quantifies change.** Reports Sen's slope per year and per decade in the variable's display
  unit.
- **Tests significance.** Uses the Hamed–Rao modified Mann–Kendall test with
  Benjamini–Hochberg FDR control across cells at q < 0.05 — not a raw p-value threshold.
- **Traces evidence.** Every cell, region and country links back to its slope, q-value,
  coverage, product, DOI and method.
- **Flags data problems.** A Pettitt change-point test plus a step-versus-linear ΔBIC check
  marks cells where a change looks like a sudden jump; a break inside a documented GLDAS
  forcing-change period gets a second code. A flag is a warning to read the evidence, not a
  verdict that the data are wrong.
- **Tells a story.** Detective Cases are selected from computed, unflagged results, and Story
  mode walks through the evidence. If the evidence does not support a local case, the case is
  omitted rather than forced.

## Screenshots

> Placeholders — capture these from the published real export after P08; do not ship mock-data
> screenshots.

| Screen | Placeholder |
|---|---|
| Home / headline insights | `docs/submission/screenshots/home.png` |
| Variable Screener | `docs/submission/screenshots/screener.png` |
| Global Discovery map | `docs/submission/screenshots/discovery.png` |
| Region / country explorer | `docs/submission/screenshots/region.png` |
| Story mode / Detective Case | `docs/submission/screenshots/story.png` |

## How it works

```text
NASA GES DISC files
  → ingest (earthaccess)
  → harmonize to the 1° contract grid + common land mask (Greenland/snow-ice excluded)
  → monthly anomalies against the 2001–2020 baseline
  → Sen slope + Hamed–Rao modified Mann–Kendall + BH-FDR
  → data-quality flags (Pettitt + ΔBIC)
  → validated static export (schema 1.2)
  → React + TypeScript app (Screener, Discovery, Region, Story)
```

The web app reads a precomputed, validated export. No scientific result is computed in the
browser and no language model generates a finding. Live region/box statistics are explicitly
labelled “computed in browser: single test on the region average, original Mann–Kendall, no FDR
correction”.

## Quick start

Python (uses [uv](https://docs.astral.sh/uv/)):

```bash
uv venv --python 3.12
uv pip install -e ".[dev]"
.venv/Scripts/python -m pytest
```

Web:

```bash
cd web
npm install
npm run dev
```

Open the URL printed by Vite. The app serves the dataset in `web/public/data/`; the current
folder contains the real schema-1.1 export. To regenerate synthetic mock data for UI work:

```bash
.venv/Scripts/python scripts/make_mock_data.py
```

Mock files carry `"synthetic": true` and the UI shows a visible “SYNTHETIC DATA” banner.

### Running the real pipeline

The full order is in `docs/SCIENTIFIC_METHODOLOGY.md` §12. The short version:

```bash
.venv/Scripts/python scripts/p02_download.py      # resumable, needs Earthdata login
.venv/Scripts/python scripts/p02_harmonize.py     # cubes + common mask
.venv/Scripts/python scripts/p02_anomalies.py     # anomalies + mask copy
.venv/Scripts/python scripts/p02_validate.py      # plausibility + quick-looks
.venv/Scripts/python scripts/p03_run.py           # trends + correlations
.venv/Scripts/python scripts/p_export.py          # contract export
.venv/Scripts/python scripts/validate_export.py data/export/web_data --release
```

### NASA Earthdata access

Data downloads need a free [NASA Earthdata Login](https://urs.earthdata.nasa.gov/) with the
*NASA GESDISC DATA ARCHIVE* application authorised. Credentials are read by `earthaccess`
from a local `.netrc`/`_netrc` file or environment variables and **must never be committed**.

## Data sources

| Product | Version | Role | DOI |
|---|---|---|---|
| GLDAS Noah Land Surface Model L4 monthly 1.0° (`GLDAS_NOAH10_M`) | 2.1 | skin temperature, root-zone and surface soil moisture, evapotranspiration, air temperature, specific humidity | `10.5067/LWTYSMP3VM5Z` |
| GPM IMERG Final Precipitation L3 monthly 0.1° (`GPM_3IMERGM`) | 07 | precipitation | `10.5067/GPM/IMERG/3B-MONTH/07` |

Both are NASA GES DISC products. The analysis uses the **1°** GLDAS product; its native cell
centres match the contract grid, so no GLDAS regridding is needed. IMERG is aggregated from
0.1° to 1° with `cos(latitude)` weights and a 50% valid-area rule.

Exact collection IDs, file-level units, fill values, access dates and checksums are in
`docs/DATA_PROVENANCE.md` and `docs/DATA_DICTIONARY.md`. The product versions and DOIs above
come from `config/variables.yaml`.

**Boundaries.** Country regions use Natural Earth admin-0 (`countries-50m`), which is public
domain: <https://www.naturalearthdata.com/>. Natural Earth is credited in the app; it is not a
NASA product.

## Documentation

| Document | Contents |
|---|---|
| `docs/SCIENTIFIC_METHODOLOGY.md` | Scope, data, harmonization, anomalies, trends, FDR, quality flags, Screener, patterns, validation, reproducibility, AI use, references |
| `docs/LIMITATIONS.md` | What each limitation is and how it changes the reading of a result |
| `docs/DATA_CONTRACT.md` | The producer/consumer contract (grid, files, schema 1.2) |
| `docs/DATA_PROVENANCE.md` | Verified product, collection, file and checksum facts |
| `docs/DATA_DICTIONARY.md` | Variable-level units, fill values and semantics |
| `docs/submission/` | Project summary, demo script, slide outline, checklist, requirements verification |
| `docs/packages/` | Work-package specs, reports and coordination rules |
| `EarthPulse_NASA_Space_Apps_2026_Project_Plan.md` | Full project plan |

## Project layout

| Path | Contents |
|---|---|
| `earthpulse/` | Python package: ingestion, harmonization, anomalies, statistics, quality, export |
| `scripts/` | Command-line pipeline steps |
| `tests/` | pytest suite (synthetic data only) |
| `data/` | Local data; raw/interim/processed are git-ignored |
| `docs/` | Methodology, contract, provenance, limitations, submission kit |
| `web/` | React + TypeScript + Vite frontend |

## AI use

AI coding assistants, including OpenCode and Claude Code, assisted with code, tests,
documentation and review. They are not the scientific engine: every slope, p-value, q-value,
correlation, class and quality flag comes from the statistical pipeline and the downloaded
NASA data. No LLM runs in the scientific path, and no LLM is allowed to invent a value,
metadata field or finding. The app works without an LLM.

## License

Apache-2.0. See [LICENSE](LICENSE). Natural Earth data are public domain. NASA data are used
under their published GES DISC terms; EarthPulse does not imply NASA endorsement and does not
use NASA logos, flags or mission identifiers as project branding.
