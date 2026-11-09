# EarthPulse

**Evidence-first Earth system change detection.** EarthPulse turns 24 years of NASA
land-surface data into an explorable evidence trail: which variables are changing, where, how
much, and whether the change is statistically significant — with a visible warning when a
change looks like a data discontinuity rather than a climate trend.

Built for the NASA Space Apps Challenge 2026, challenge *Be An Earth System Trend Detective!*
(<https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/>).

> **Status (2026-11-09):** the app and pipeline work end to end on real data. The published
> export is schema **1.2**: **3,558 files, 290.2 MB**, validated with `--release`, no synthetic
> flag. It includes the Greenland/snow-ice mask (**14,250** cells), data-quality layers,
> **143 country domains** and five P06d Detective Cases: China/Mongolia and Southern/Eastern
> Africa soil moisture, South America rainfall, Algeria/Morocco warming + drying, and the
> **Vietnam caution case** (“Vietnam is warming — but check the 2012 jump”). The cases use the
> 2001–2024 quality cross-check and the Finding 1 flag wording.

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
  marks cells where a change looks like a sudden jump. **Code 2:** “Sudden shift during a
  documented GLDAS input change (2008–2012): possible data discontinuity. Read the trend with
  caution.” **Code 1:** “Sudden shift around {year}: this could be a real jump in the climate
  or a data artefact. The trend is still significant; a step fits slightly better than a
  straight line.” A flag is a warning to read the evidence, never “wrong” or “error”.
- **Tells a story.** Detective Cases are selected from computed results, and Story mode walks
  through the evidence. Findings exclude flagged cells; the Vietnam caution case includes them
  on purpose so the local warming trend can be read with its warning attached.

## At a glance (2001–2024, published schema 1.2)

- **Air temperature:** **58.4%** of land shows a significant increase and **4.0%** a significant
  decrease; **35.1%** of the area carries a quality flag (49% of the significant area), so the
  warming map is evidence to inspect, not a finished finding.
- **Precipitation (IMERG):** **5.7%** significant increase vs **6.2%** significant decrease,
  regional contrast **0.479** — the challenge's “same process, opposite trends” pattern.
- **Vietnam caution case (30 cells):** air temperature rises **+0.42 °C per decade**
  (q = **1.70e-3**), but **53.6%** of the area is flagged with a median break at **≈ 2012**,
  inside the documented GLDAS **2008–2012** input change. The country screen also shows
  **63.5%** significant warming and **86.9%** significant evapotranspiration increase.

Every figure comes from `web/public/data/screener/2001-2024/global.json` and
`country_704.json`; see `docs/submission/PROJECT_SUMMARY.md` for the full table.

## Screenshots

Real screenshots from the published schema-1.2 app, captured after P06d and the Finding 1
wording:

| Screen | Screenshot |
|---|---|
| Home / headline insights | ![Home](docs/submission/screenshots/home.png) |
| Variable Screener | ![Screener](docs/submission/screenshots/screener.png) |
| Global Discovery map | ![Discovery](docs/submission/screenshots/discovery.png) |
| Region / country explorer (Vietnam) | ![Region](docs/submission/screenshots/region.png) |
| Story mode / Vietnam caution case | ![Story](docs/submission/screenshots/story.png) |
| Data-quality layer and flag wording | ![Quality flag](docs/submission/screenshots/quality_flag.png) |

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
folder contains the real schema-1.2 export. To regenerate synthetic mock data for UI work:

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
