import {
  cellIndex,
  colToLon,
  N_COLS,
  N_MONTHS,
  N_ROWS,
  rowToLat,
  tileIdFor,
  type FloatLayer,
} from '../../data/contract'
import {
  cellSeriesFromTile,
  loadBreakpointYear,
  loadCorrelationLayer,
  loadCountries,
  loadCountryGrid,
  loadFloatLayer,
  loadQualityFlag,
  loadRegionSeries,
  loadRegions,
  loadTile,
  loadTrendClass,
} from '../../data/loaders'
import type { Country, DataIndex, Region, Selection, VariableMeta, WindowMeta } from '../../data/types'
import {
  aggregateBbox,
  alignToMonths,
  buildBrowserEvidence,
  buildCellEvidence,
  cellTrendLine,
  cellsInsideBbox,
  floatSeriesToValues,
  formatLat,
  formatLon,
  layerValue,
  meanFinite,
  tileIdsForRange,
  windowMonths,
  type CellRange,
  type EvidenceModel,
  type LoadedTile,
  type TrendLine,
} from './model'
import { cellQuality, qualityShareForCountry, qualityShareForRange, type QualitySummary } from './quality'
import {
  witnessAgreementCode,
  witnessProductInfo,
  witnessTrendFromSeries,
  type WitnessInfo,
} from './witness'

export interface PlaceData {
  title: string
  detail: string
  /** Includes the preposition, e.g. "in Vietnam". */
  plainLabel: string
  note: string | null
  unit: string
  months: string[]
  values: (number | null)[]
  anomalies: (number | null)[]
  evidence: EvidenceModel
  trend: TrendLine | null
  quality: QualitySummary | null
  country: Country | null
  /** Schema 1.3 second-witness series, when the export has one. */
  witness: WitnessInfo | null
  /** Region-series valid_cell_fraction, aligned to index.months; null for cell/box. */
  validFraction: (number | null)[] | null
}

export interface LoadHooks {
  onProgress?: (message: string) => void
}

const CELL_LAYERS: FloatLayer[] = [
  'sen_slope',
  'sen_slope_decade',
  'p_value',
  'q_value',
  'mk_tau',
  'n_valid',
  'coverage',
]

function positional(values: readonly (number | null)[], months: readonly string[]): (number | null)[] {
  return months.map((_, i) => (i < values.length ? values[i] : null))
}

function windowLabel(window: WindowMeta): string {
  return `${window.start} to ${window.end} (${window.id})`
}

function requireWindow(index: DataIndex, window: WindowMeta): { start: number; end: number; months: string[] } {
  const months = windowMonths(index.months, window.start, window.end)
  if (months.length === 0) throw new Error(`The window ${window.id} is outside the month calendar.`)
  const start = index.months.indexOf(months[0])
  const end = index.months.indexOf(months[months.length - 1])
  return { start, end, months }
}

async function loadTilePair(
  variableId: string,
  tileIds: string[],
  anomaliesOnly: boolean,
  onProgress?: (message: string) => void,
): Promise<Map<string, LoadedTile>> {
  const tiles = new Map<string, LoadedTile>()
  let done = 0
  onProgress?.(`Loading tiles… 0 of ${tileIds.length}. Each tile is about 115 KB.`)
  await Promise.all(
    tileIds.map(async (tileId) => {
      const values = anomaliesOnly ? null : await loadTile(variableId, tileId, 'values')
      const anomalies = await loadTile(variableId, tileId, 'anomalies')
      tiles.set(tileId, { values, anomalies })
      done += 1
      onProgress?.(`Loading tiles… ${done} of ${tileIds.length}. Each tile is about 115 KB.`)
    }),
  )
  return tiles
}

async function loadCellQuality(
  index: DataIndex,
  variableId: string,
  windowId: string,
  row: number,
  col: number,
): Promise<QualitySummary | null> {
  if (!index.quality) return null
  try {
    const [flagLayer, breakLayer] = await Promise.all([
      loadQualityFlag(variableId, windowId),
      loadBreakpointYear(variableId, windowId),
    ])
    if (!flagLayer) return null
    return cellQuality(flagLayer, breakLayer, row, col)
  } catch {
    // Quality layers are optional (schema 1.2): absent files must not break the page.
    return null
  }
}

async function loadRangeQuality(
  index: DataIndex,
  variableId: string,
  windowId: string,
  range: CellRange,
): Promise<QualitySummary | null> {
  if (!index.quality) return null
  try {
    const [flagLayer, breakLayer] = await Promise.all([
      loadQualityFlag(variableId, windowId),
      loadBreakpointYear(variableId, windowId),
    ])
    if (!flagLayer) return null
    return qualityShareForRange(flagLayer, breakLayer, range)
  } catch {
    return null
  }
}

async function loadRegionQuality(
  index: DataIndex,
  variableId: string,
  windowId: string,
  region: Region | null,
  country: Country | null,
): Promise<QualitySummary | null> {
  if (!index.quality) return null
  try {
    if (country) {
      const [flagLayer, breakLayer, countryGrid] = await Promise.all([
        loadQualityFlag(variableId, windowId),
        loadBreakpointYear(variableId, windowId),
        loadCountryGrid(),
      ])
      if (!flagLayer || !countryGrid) return null
      return qualityShareForCountry(flagLayer, breakLayer, countryGrid, country.index)
    }
    if (!region) return null
    const range = cellsInsideBbox(region.bbox)
    if (!range) return null
    return loadRangeQuality(index, variableId, windowId, range)
  } catch {
    return null
  }
}

/** Anomaly series for the comparison chart, aligned to index.months. */
export async function loadAnomalies(
  index: DataIndex,
  variableId: string,
  selection: Exclude<Selection, null>,
  onProgress?: (message: string) => void,
): Promise<(number | null)[]> {
  if (selection.kind === 'cell') {
    const tile = await loadTile(variableId, tileIdFor(selection.row, selection.col), 'anomalies')
    if (!tile) return index.months.map(() => null)
    return positional(floatSeriesToValues(cellSeriesFromTile(tile, selection.row, selection.col)), index.months)
  }
  if (selection.kind === 'region') {
    const series = await loadRegionSeries(selection.regionId, variableId)
    return alignToMonths(series.months, series.anomalies, index.months)
  }
  const range = cellsInsideBbox(selection.bbox)
  if (!range) return index.months.map(() => null)
  const known = new Set(index.tiles.ids)
  const present = tileIdsForRange(range).filter((id) => known.has(id))
  const tiles = await loadTilePair(variableId, present, true, onProgress)
  return aggregateBbox({
    range,
    months: N_MONTHS,
    tiles,
    windowStart: 0,
    windowEnd: N_MONTHS - 1,
  }).anomalies
}

/** Precomputed Spearman ρ (`r`, not `r_detrended`) at one cell. Null when the cell was not evaluated. */
export async function loadCellSpearman(
  pair: string,
  windowId: string,
  row: number,
  col: number,
): Promise<{ rho: number; n: number | null } | null> {
  const [rhoLayer, nLayer] = await Promise.all([
    loadCorrelationLayer(pair, windowId, 'r'),
    loadCorrelationLayer(pair, windowId, 'n_pairs'),
  ])
  const rho = layerValue(rhoLayer, row, col)
  if (rho == null) return null
  return { rho, n: layerValue(nLayer, row, col) }
}

export async function loadPlace(
  index: DataIndex,
  variable: VariableMeta,
  window: WindowMeta,
  selection: Exclude<Selection, null>,
  hooks: LoadHooks = {},
): Promise<PlaceData> {
  const calendar = requireWindow(index, window)
  const label = windowLabel(window)
  if (selection.kind === 'cell') return loadCell(index, variable, window.id, selection, calendar, label, hooks)
  if (selection.kind === 'region')
    return loadRegion(index, variable, selection.regionId, window.id, calendar, label, hooks)
  return loadBox(index, variable, selection.bbox, window.id, calendar, label, hooks)
}

async function loadCell(
  index: DataIndex,
  variable: VariableMeta,
  windowId: string,
  selection: { kind: 'cell'; row: number; col: number },
  calendar: { months: string[] },
  label: string,
  hooks: LoadHooks,
): Promise<PlaceData> {
  const { row, col } = selection
  if (row < 0 || col < 0 || row >= N_ROWS || col >= N_COLS) throw new Error('That cell is outside the grid.')
  hooks.onProgress?.('Loading the cell series and precomputed layers…')
  const wanted = CELL_LAYERS.filter((name) => index.layers.float.includes(name))
  const tileId = tileIdFor(row, col)
  const [valuesTile, anomalyTile, trendClass, layerList, quality] = await Promise.all([
    loadTile(variable.id, tileId, 'values'),
    loadTile(variable.id, tileId, 'anomalies'),
    index.layers.class.includes('trend_class') ? loadTrendClass(variable.id, windowId) : Promise.resolve(null),
    Promise.all(wanted.map((name) => loadFloatLayer(variable.id, windowId, name))),
    loadCellQuality(index, variable.id, windowId, row, col),
  ])
  const layerAt = (name: FloatLayer) => {
    const position = wanted.indexOf(name)
    return position >= 0 ? layerList[position] : null
  }
  const perYear = layerValue(layerAt('sen_slope'), row, col)
  const hasDecade = wanted.includes('sen_slope_decade')
  const decade = hasDecade ? layerValue(layerAt('sen_slope_decade'), row, col) : null
  const senSlopeDecade = hasDecade ? decade : perYear == null ? null : perYear * 10
  const anomalies = positional(
    anomalyTile ? floatSeriesToValues(cellSeriesFromTile(anomalyTile, row, col)) : [],
    index.months,
  )
  const values = positional(
    valuesTile ? floatSeriesToValues(cellSeriesFromTile(valuesTile, row, col)) : [],
    index.months,
  )
  return {
    title: `Cell row ${row}, column ${col}`,
    detail: `${formatLat(rowToLat(row))}, ${formatLon(colToLon(col))}. One grid cell.`,
    plainLabel: 'at this grid cell',
    note:
      valuesTile == null && anomalyTile == null
        ? `No monthly tile is exported for ${tileId}. The evidence card still uses the precomputed grid layers.`
        : null,
    unit: variable.display_unit,
    months: index.months,
    values,
    anomalies,
    evidence: buildCellEvidence({
      variable,
      windowLabel: label,
      monthsInWindow: calendar.months.length,
      senSlopeDecade,
      p: layerValue(layerAt('p_value'), row, col),
      q: layerValue(layerAt('q_value'), row, col),
      tau: layerValue(layerAt('mk_tau'), row, col),
      nValid: layerValue(layerAt('n_valid'), row, col),
      coverage: layerValue(layerAt('coverage'), row, col),
      trendClass: trendClass ? trendClass[cellIndex(row, col)] : null,
    }),
    trend: cellTrendLine(
      calendar.months,
      alignToMonths(index.months, anomalies, calendar.months),
      senSlopeDecade == null ? null : senSlopeDecade / 10,
    ),
    quality,
    country: null,
    witness: null,
    validFraction: null,
  }
}

async function loadRegion(
  index: DataIndex,
  variable: VariableMeta,
  regionId: string,
  windowId: string,
  calendar: { months: string[] },
  label: string,
  hooks: LoadHooks,
): Promise<PlaceData> {
  hooks.onProgress?.('Loading the region series…')
  const [series, regions, countries] = await Promise.all([
    loadRegionSeries(regionId, variable.id),
    loadRegions(),
    loadCountries(),
  ])
  const region = regions.find((item) => item.id === regionId) ?? null
  const country = countries.find((item) => item.id === regionId) ?? null
  const quality = await loadRegionQuality(index, variable.id, windowId, region, country)
  const values = alignToMonths(series.months, series.values, index.months)
  const anomalies = alignToMonths(series.months, series.anomalies, index.months)
  const built = buildBrowserEvidence({
    variable,
    windowLabel: label,
    windowMonths: calendar.months,
    anomalies: alignToMonths(index.months, anomalies, calendar.months),
    coverage: meanFinite(alignToMonths(series.months, series.valid_cell_fraction, calendar.months)),
    coverageNote: 'Mean of valid_cell_fraction over months in this window.',
  })
  const title = country?.label ?? region?.label ?? regionId
  const box = country?.bbox ?? region?.bbox ?? null
  const boxText = box ? ` Approximate bbox [west, south, east, north]: ${box.join(', ')}.` : ''
  const detail = country
    ? `Country region from Natural Earth. ${country.n_cells} grid cells inside the common mask.${boxText}`
    : `Predefined region. The box is approximate.${boxText}`
  const validFraction = alignToMonths(series.months, series.valid_cell_fraction, index.months)
  const witnessProduct = witnessProductInfo(index, variable.id)
  const witnessAnomalies =
    series.witness_anomalies && series.witness_anomalies.length > 0
      ? alignToMonths(series.months, series.witness_anomalies, index.months)
      : null
  const witnessTrend =
    witnessAnomalies && witnessAnomalies.length > 0
      ? witnessTrendFromSeries(
          index.months,
          witnessAnomalies,
          calendar.months[0] ?? windowId,
          calendar.months[calendar.months.length - 1] ?? windowId,
        )
      : null
  const witness: WitnessInfo | null =
    witnessProduct && witnessAnomalies
      ? {
          ...witnessProduct,
          unit: series.witness_unit ?? null,
          anomalies: witnessAnomalies,
          trend: witnessTrend,
          agreement: witnessAgreementCode(built.evidence.trendClass, witnessTrend),
        }
      : null
  return {
    title,
    detail,
    plainLabel: `in ${title}`,
    note: null,
    unit: series.unit || variable.display_unit,
    months: index.months,
    values,
    anomalies,
    evidence: built.evidence,
    trend: built.trend,
    quality,
    country,
    witness,
    validFraction,
  }
}

async function loadBox(
  index: DataIndex,
  variable: VariableMeta,
  bbox: [number, number, number, number],
  windowId: string,
  calendar: { start: number; end: number; months: string[] },
  label: string,
  hooks: LoadHooks,
): Promise<PlaceData> {
  const [west, south, east, north] = bbox
  const title = `Custom box ${formatLon(west)} to ${formatLon(east)}, ${formatLat(south)} to ${formatLat(north)}`
  const range = cellsInsideBbox(bbox)
  if (!range) {
    const empty = index.months.map(() => null)
    const built = buildBrowserEvidence({
      variable,
      windowLabel: label,
      windowMonths: calendar.months,
      anomalies: calendar.months.map(() => null),
      coverage: null,
      coverageNote: 'No grid-cell centres fall inside this box.',
      cellsInBox: 0,
      maskCells: 0,
      cellsUsed: 0,
      missingTiles: [],
    })
    return {
      title,
      detail: 'Approximate box. No 1° cell centre falls inside it.',
      plainLabel: 'in this custom box',
      note: 'Widen the box so that it contains at least one cell centre.',
      unit: variable.display_unit,
      months: index.months,
      values: empty,
      anomalies: empty,
      evidence: built.evidence,
      trend: null,
      quality: null,
      country: null,
      witness: null,
      validFraction: null,
    }
  }
  const known = new Set(index.tiles.ids)
  const present = tileIdsForRange(range).filter((id) => known.has(id))
  const [tiles, quality] = await Promise.all([
    loadTilePair(variable.id, present, false, hooks.onProgress),
    loadRangeQuality(index, variable.id, windowId, range),
  ])
  const aggregated = aggregateBbox({
    range,
    months: N_MONTHS,
    tiles,
    windowStart: calendar.start,
    windowEnd: calendar.end,
  })
  const built = buildBrowserEvidence({
    variable,
    windowLabel: label,
    windowMonths: calendar.months,
    anomalies: alignToMonths(index.months, aggregated.anomalies, calendar.months),
    coverage: aggregated.maskCells > 0 ? aggregated.cellsUsed / aggregated.maskCells : null,
    coverageNote: 'Share of in-box mask cells that contributed at least one value in this window.',
    cellsInBox: aggregated.cellsInBox,
    maskCells: aggregated.maskCells,
    cellsUsed: aggregated.cellsUsed,
    missingTiles: aggregated.missingTiles,
  })
  return {
    title,
    detail: 'Approximate box. Area-weighted mean of cells with data, weighted by cos(latitude).',
    plainLabel: 'in this custom box',
    note: null,
    unit: variable.display_unit,
    months: index.months,
    values: aggregated.values,
    anomalies: aggregated.anomalies,
    evidence: built.evidence,
    trend: built.trend,
    quality,
    country: null,
    witness: null,
    validFraction: null,
  }
}
