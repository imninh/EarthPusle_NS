// Types for the files described in docs/DATA_CONTRACT.md.

export interface VariableMeta {
  id: string
  label: string
  category: string
  product: string
  product_version: string
  doi: string | null
  source_type: 'model' | 'mission_observation'
  source_variable: string
  display_unit: string
  slope_unit: string
  description: string
  caveats: string[]
  core: boolean
  increase_means: string
}

export interface WindowMeta {
  id: string
  start: string
  end: string
}

export interface DataIndex {
  schema_version: string
  generated_at: string
  synthetic: boolean
  grid: { resolution_deg: number; n_rows: number; n_cols: number; lat_north_center: number; lon_west_center: number }
  months: string[]
  baseline: [string, string]
  windows: WindowMeta[]
  q_threshold: number
  variables: VariableMeta[]
  pattern_pair: { temperature: string; moisture: string }
  correlation_pairs: string[]
  layers: { float: string[]; class: string[] }
  tiles: { size: number; ids: string[] }
  /** Schema 1.2 (§12): present only when quality layers were exported. */
  quality?: {
    method: string
    layers: string[]
    known_forcing_changes: Record<string, [number, number]>
  }
}

export interface Region {
  id: string
  label: string
  /** [west, south, east, north] in degrees */
  bbox: [number, number, number, number]
  /** Schema 1.2: "box" for the predefined approximate boxes. */
  kind?: 'box'
}

/** Schema 1.2 (§11): a country domain. */
export interface Country {
  id: string
  label: string
  iso_numeric: string
  /** Value used for this country in country_grid.i16 */
  index: number
  /** Cells inside the common mask */
  n_cells: number
  bbox: [number, number, number, number]
}

export interface RegionsFile {
  regions: Region[]
  countries?: Country[]
  country_grid?: string
}

export interface ScreenerRow {
  variable: string
  valid_area_fraction: number
  sig_increase_area_fraction: number
  sig_decrease_area_fraction: number
  median_abs_std_change_decade: number | null
  median_sen_slope_decade_sig: number | null
  regional_contrast: number | null
  n_cells_evaluated: number
  /** Schema 1.2 (§12), optional */
  step_flag_area_fraction?: number | null
  /** Schema 1.2 (§12), optional */
  sig_trend_flagged_fraction?: number | null
}

export interface ScreenerFile {
  window: string
  domain: string
  synthetic: boolean
  rows: ScreenerRow[]
}

export interface RegionSeries {
  region: string
  variable: string
  synthetic: boolean
  unit: string
  months: string[]
  values: (number | null)[]
  anomalies: (number | null)[]
  valid_cell_fraction: (number | null)[]
}

export interface EvidenceItem {
  variable: string
  product: string
  method: string
  sen_slope_decade: number
  slope_unit: string
  p_value: number
  q_value: number
  valid_observations: number
  coverage_fraction: number
  trend_class: number
}

export interface DetectiveCase {
  id: string
  title: string
  region: { bbox: [number, number, number, number]; label: string }
  window: string
  why_selected: string
  evidence: EvidenceItem[]
  limitations: string[]
}

export interface CasesFile {
  synthetic: boolean
  selection_method: string
  cases: DetectiveCase[]
}

/** What the user is currently inspecting. */
export type Selection =
  | { kind: 'cell'; row: number; col: number }
  | { kind: 'region'; regionId: string } // a box region id or, from schema 1.2, a country id (country_XXX)
  | { kind: 'bbox'; bbox: [number, number, number, number] }
  | null

export type Page = 'home' | 'screener' | 'discovery' | 'region' | 'story'
