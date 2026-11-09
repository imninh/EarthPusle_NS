"""Shared constants for the EarthPulse data contract.

Single source of truth for the analysis grid, class codes, window ids and file layout.
Every package (pipeline, export, mock data, tests) imports from here instead of
re-declaring values. The human-readable specification is docs/DATA_CONTRACT.md;
the frontend mirror is web/src/data/contract.ts. Change all three together.
"""

from __future__ import annotations

SCHEMA_VERSION = "1.2"

# --- Analysis grid -------------------------------------------------------------------
# Global 1-degree grid, cell centres. Row 0 is the northernmost row (lat 89.5),
# column 0 is the westernmost column (lon -179.5). Arrays are row-major [row, col].
RESOLUTION_DEG = 1.0
N_ROWS = 180
N_COLS = 360
LAT_NORTH_CENTER = 89.5
LON_WEST_CENTER = -179.5


def row_to_lat(row: int) -> float:
    return LAT_NORTH_CENTER - row * RESOLUTION_DEG


def col_to_lon(col: int) -> float:
    return LON_WEST_CENTER + col * RESOLUTION_DEG


def lat_to_row(lat: float) -> int:
    return int((90.0 - lat) // RESOLUTION_DEG)


def lon_to_col(lon: float) -> int:
    return int((lon + 180.0) // RESOLUTION_DEG)


# --- Time ----------------------------------------------------------------------------
FIRST_MONTH = "2001-01"
LAST_MONTH = "2024-12"
N_MONTHS = 288
BASELINE = ("2001-01", "2020-12")

# Precomputed analysis windows (provisional; final list set by the export step).
WINDOWS = {
    "2001-2024": ("2001-01", "2024-12"),
    "2001-2012": ("2001-01", "2012-12"),
    "2013-2024": ("2013-01", "2024-12"),
}

# --- Significance ----------------------------------------------------------------------
Q_THRESHOLD = 0.05  # FDR (Benjamini-Hochberg) adjusted q-value threshold
MIN_VALID_FRACTION = 0.8  # minimum fraction of valid months in the window
MIN_YEARS = 10  # windows shorter than this are not evaluated

# --- Class codes (int8) ----------------------------------------------------------------
OUTSIDE_DOMAIN = -99  # ocean / outside the common land mask
INSUFFICIENT_DATA = -9  # inside domain but fails coverage rules

TREND_INCREASE = 1
TREND_DECREASE = -1
TREND_NOT_SIGNIFICANT = 0

PATTERN_MIXED = 0
PATTERN_WARMING_DRYING = 1
PATTERN_WARMING_WETTING = 2
PATTERN_COOLING_DRYING = 3
PATTERN_COOLING_WETTING = 4

# --- Binary layer encoding ---------------------------------------------------------------
# Float layers: little-endian float32, N_ROWS * N_COLS values, NaN = missing.
# Class layers: int8, N_ROWS * N_COLS values, codes above.
FLOAT_LAYERS = (
    "sen_slope",  # per year, in the variable's display unit
    "sen_slope_decade",  # per decade, display unit
    "std_change_decade",  # slope per decade / std of detrended anomalies
    "p_value",  # autocorrelation-aware Mann-Kendall p-value
    "p_value_original",  # unmodified Mann-Kendall p-value (comparison only)
    "q_value",  # BH-FDR adjusted p_value
    "mk_tau",
    "n_valid",  # number of valid months in the window
    "coverage",  # n_valid / months in window
)
CLASS_LAYERS = ("trend_class",)

# Time-series tiles: 10 x 10 cells, float32 little-endian, shape [N_MONTHS, 10, 10].
TILE_SIZE = 10

# Correlation pair ids (variable ids joined with "__", alphabetical order).
CORRELATION_LAYERS = ("r", "q", "r_detrended", "q_detrended", "n_pairs")

# --- Schema 1.2: data-quality layers (docs/DATA_CONTRACT.md §12) ------------------------
QUALITY_NONE = 0
QUALITY_STEP = 1
QUALITY_STEP_KNOWN_FORCING = 2
QUALITY_LAYERS = ("quality_flag", "breakpoint_year")
QUALITY_FDR_Q = 0.05
QUALITY_MIN_DELTA_BIC = 2.0
KNOWN_FORCING_CHANGES = {"GLDAS_NOAH10_M": (2008, 2012)}

# --- Schema 1.2: country regions (docs/DATA_CONTRACT.md §11) -----------------------------
COUNTRY_NONE = -1
COUNTRY_MIN_CELLS = 3
COUNTRY_GRID_FILE = "regions/country_grid.i16"
