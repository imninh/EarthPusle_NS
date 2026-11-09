# EarthPulse

Evidence-first Earth system change detection for the NASA Space Apps Challenge 2026
(challenge: *Be An Earth System Trend Detective!*).

EarthPulse analyses monthly land-surface temperature, root-zone soil moisture (NASA GLDAS Noah 2.1)
and precipitation (NASA GPM IMERG Final Monthly V07), detects trends with Sen's slope and
Mann–Kendall tests (FDR-corrected), and lets users trace every finding back to the data and method.

> Status: project setup. No scientific results have been produced yet.

Full plan: [EarthPulse_NASA_Space_Apps_2026_Project_Plan.md](EarthPulse_NASA_Space_Apps_2026_Project_Plan.md)

## Layout

| Path | Contents |
|---|---|
| `earthpulse/` | Python package: processing and statistics |
| `scripts/` | Command-line pipeline steps (download, preprocess, analyse, export) |
| `notebooks/` | Data inspection and validation notebooks |
| `tests/` | pytest suite (synthetic data only) |
| `data/` | Local data; raw/interim/processed are git-ignored |
| `docs/` | Methodology, data dictionary, provenance, limitations |
| `web/` | React + TypeScript + Vite frontend |

## Setup

Python (uses [uv](https://docs.astral.sh/uv/)):

```bash
uv venv --python 3.12
uv pip install -e ".[dev]"
.venv/Scripts/python -m pytest
```

Frontend:

```bash
cd web
npm install
npm run dev
```

### NASA Earthdata access

Data downloads need a free [NASA Earthdata Login](https://urs.earthdata.nasa.gov/) with the
*NASA GESDISC DATA ARCHIVE* application authorised. Credentials are read by `earthaccess`
from a local `.netrc`/`_netrc` file or environment variables and must never be committed.

## Data sources

- GLDAS Noah Land Surface Model L4 Monthly V2.1 (`GLDAS_NOAH025_M`), NASA GES DISC
- GPM IMERG Final Precipitation L3 Monthly V07 (`GPM_3IMERGM`), NASA GES DISC

Exact versions, DOIs and access dates are recorded in `docs/DATA_PROVENANCE.md` once verified.

## License

Apache-2.0. See [LICENSE](LICENSE).
