# EarthPulse

**EarthPulse tells high-school and college students whether a trend in NASA Earth data is real: it
tests every place on the land map, then cross-examines each result with a data-quality check and,
where one exists, a second NASA dataset.** Built for the NASA Space Apps Challenge 2026, challenge *Be An Earth System
Trend Detective!* (<https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/>).

**Try it:** <https://imninh.github.io/EarthPusle_NS/> (public, no login) · Source: <https://github.com/imninh/EarthPusle_NS>

### Your first 60 seconds (three clicks)

1. On Home, click **Start an investigation**.
2. Under the place question, click the **Vietnam** shortcut.
3. On the first card, click **Open the evidence**. You see the monthly series, the rate of change
   with its 95% interval, any data-quality warning, and a switch for the second dataset.
   (To see air temperature specifically, choose the **Heat** topic first; that is one more click.)

> **Status (2026-11-14):** the app and pipeline work end to end on real data. The published
> export is schema **1.3**: **11 variables, 5,348 files, 458.5 MiB**, validated with `--release`,
> no synthetic flag, with the Greenland/snow-ice mask (**14,250** cells), data-quality layers,
> **143 country domains**, five Detective Cases and the **second dataset** (MERRA-2 / GPCP) for the
> seven land variables. The local example is the **Vietnam caution case**: two NASA datasets, one
> disagreement, a documented kind of cause.

## What it does

- **Screens variables.** Ranks 11 variables (seven land variables from GLDAS and IMERG, and four
  atmosphere variables from MERRA-2: air temperature at 850 hPa and 500 hPa, column water vapour,
  total ozone) by the area with a statistically significant trend, median standardized change, signed Sen slope and regional contrast.
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
- **Checks with a second witness.** Every significant trend in the seven land variables is
  compared with the same test on an independent NASA product; the four atmosphere variables have
  no second dataset. Agreement is corroboration, not ground truth: MERRA-2 is a
  reanalysis and GPCP shares gauge inputs with IMERG.
- **Tells a story.** Detective Cases are selected from computed results, and Story mode walks
  through the evidence. Findings exclude flagged cells; the Vietnam caution case includes them
  on purpose so the warming trend can be read with its warning and witness disagreement attached.
- **Guides an investigation.** Three questions — where, what, which years — become a ranked
  shortlist of published variables for that place, with a plain-language verdict, the area
  share, a data-quality warning where one applies, a worked example when a published case
  matches, and one-click links to the evidence (`#/investigate`). The question-to-variable
  mapping is a fixed, documented rule; no language model chooses it.
- **Shows how sure the numbers are.** Region and custom-box evidence carries a **95%
  confidence interval** for the rate of change, and a non-significant trend is read as “a
  direction, not yet significant”, never “no change”. For such a trend the Region page also
  estimates how many years of data it would need to stand out (Weatherhead et al., 1998); it is
  an estimate if the same rate continued, not a forecast. The Method page explains each term.

## At a glance (2001–2024, published schema 1.3)

- **Air temperature:** **58.5%** of land shows a significant increase and **4.0%** a significant
  decrease; **35.1%** of the area carries a quality flag (48.8% of the significant area), so the
  warming map is evidence to inspect, not a finished finding. A simple Mann–Kendall test per cell
  would mark **78.0%** of land significant; the published rule marks **62.5%**
  (`scripts/c2_baseline_compare.py`).
- **Precipitation (IMERG):** **5.7%** significant increase vs **6.2%** significant decrease,
  regional contrast **0.480** — the challenge's “same process, opposite trends” pattern.
- **Vietnam caution case (30 cells).** Case figures (precomputed, cell by cell): GLDAS air
  temperature rises **+0.42 °C per decade** (q = **1.70e-3**), but **53.6%** of the area is flagged
  with a median break at **≈ 2012**, and MERRA-2 gives **+0.14 °C/decade, q = 0.08**. Region-average
  figures (computed in the browser, Hamed–Rao modified Mann–Kendall on the region average): GLDAS
  **+0.43 °C/decade, 95% interval +0.22 to +0.63, p = 0.0001**; MERRA-2 **+0.07 °C/decade, 95%
  interval −0.11 to +0.24, p = 0.4549, not significant**. The lasting 2012 shift is **+0.73 °C**
  vs **+0.12 °C**. **Two NASA datasets, one disagreement, a documented kind of cause:** warming in
  both, direction agreed, size uncertain.

Area figures come from the published export (`screener/2001-2024/global.json` and
`country_704.json`); the Vietnam second-dataset and lasting-shift numbers come from the published
`cases.json`.

## How it works

```text
NASA GES DISC files
  → ingest (earthaccess)
  → harmonize to the 1° contract grid + common land mask (Greenland/snow-ice excluded)
  → monthly anomalies against the 2001–2020 baseline
  → Sen slope + Hamed–Rao modified Mann–Kendall + BH-FDR
  → data-quality flags (Pettitt + ΔBIC)
  → validated static export (schema 1.3)
  → React + TypeScript app (Home, Investigate, Screener, Discovery, Region, Story, Method)
```

The web app reads a precomputed, validated export, and no language model generates a finding.
Every per-cell result (map, Screener, cases) is precomputed by the Python pipeline. The only
statistics computed in the browser are the live region and custom-box summaries, and they are
labelled as such: a single Hamed–Rao modified Mann–Kendall test on the region average, with no
FDR correction.

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

Open the URL printed by Vite. The app serves the dataset in `web/public/data/`, which is not in
the repository (it is about 460 MiB); the public site carries the real schema-1.3 export. To
generate synthetic mock data for UI work:

```bash
.venv/Scripts/python scripts/make_mock_data.py
```

Mock files carry `"synthetic": true` and the UI shows a visible “SYNTHETIC DATA” banner.

### Running the real pipeline

The steps, in order:

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
| MERRA-2 single-level monthly (`M2TMNXSLV`) | 5.12.4 | second dataset: air temperature, skin temperature, specific humidity; also four atmosphere variables: air temperature at 850 hPa and 500 hPa, column water vapour, total ozone | `10.5067/AP1B0BA5PD2K` |
| MERRA-2 land monthly (`M2TMNXLND`) | 5.12.4 | second dataset: evapotranspiration, soil wetness | `10.5067/8S35XF81C28F` |
| GPCP monthly (`GPCPMON`) | 3.3 | second dataset: precipitation | `10.5067/MEASURES/GPCP/DATA306` |

All five are NASA GES DISC products. The analysis uses the **1°** GLDAS product; its native cell
centres match the contract grid, so no GLDAS regridding is needed. IMERG is aggregated from
0.1° to 1° with `cos(latitude)` weights and a 50% valid-area rule.

The product versions and DOIs above come from `config/variables.yaml` and `config/witnesses.yaml`.

**Boundaries.** Country regions use Natural Earth admin-0 (`countries-50m`), which is public
domain: <https://www.naturalearthdata.com/>. Natural Earth is credited in the app; it is not a
NASA product.

## Project layout

| Path | Contents |
|---|---|
| `earthpulse/` | Python package: ingestion, harmonization, anomalies, statistics, quality, export |
| `scripts/` | Command-line pipeline steps |
| `tests/` | pytest suite (synthetic data only) |
| `data/` | Local data; raw/interim/processed are git-ignored |
| `web/` | React + TypeScript + Vite frontend |

## SI use

AI coding assistants (OpenCode and Claude Code) were used during development.

The tools were used to help write and review code, tests, documentation and the text of this
submission, and to draft screens of the web app. NASA asks that SI-generated code and data be
acknowledged in descriptive text and metadata: this statement is that acknowledgement, and the same
statement is in the project page on the NASA Space Apps site. Much of the code, test and documentation text in this repository
was generated with SI tools.

No language model produces any number in the app. Every slope, interval, p-value, q-value, quality
flag, agreement code and share comes from the Python pipeline run on the NASA files, or from a
fixed formula in the app code applied to the validated export. The app does not call a language
model and works without one. The "Start an investigation" suggestions are a fixed, documented
rule, not a model.

The challenge idea (a cross-examination of every trend) and the method choices (Sen's slope,
Hamed–Rao Mann–Kendall, Benjamini–Hochberg control, a change-point flag and a second NASA dataset)
were the team's, and SI was not used to come up with the idea.

## License

Apache-2.0. See [LICENSE](LICENSE). Natural Earth data are public domain. NASA data are used
under their published GES DISC terms; EarthPulse does not imply NASA endorsement and does not
use NASA logos, flags or mission identifiers as project branding.
