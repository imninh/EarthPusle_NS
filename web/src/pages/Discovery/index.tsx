import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import {
  GeoJSONSource,
  ImageSource,
  Map as MapLibreMap,
  type MapMouseEvent,
  type StyleSpecification,
  setWorkerUrl,
} from 'maplibre-gl'
import {
  INSUFFICIENT_DATA,
  N_COLS,
  N_ROWS,
  OUTSIDE_DOMAIN,
  PATTERN_COOLING_DRYING,
  PATTERN_COOLING_WETTING,
  PATTERN_MIXED,
  PATTERN_WARMING_DRYING,
  PATTERN_WARMING_WETTING,
  TREND_DECREASE,
  TREND_INCREASE,
  TREND_NOT_SIGNIFICANT,
  cellIndex,
  colToLon,
  latToRow,
  lonToCol,
  rowToLat,
} from '../../data/contract'
import { useApp } from '../../data/AppState'
import { loadFloatLayer, loadPatternClass, loadRegions, loadTrendClass } from '../../data/loaders'
import type { DataIndex, Region, Selection } from '../../data/types'
import {
  type ClassPalette,
  type Rgba,
  divergingColour,
  finiteAbsPercentile,
  gridImage,
  MERCATOR_LAT_LIMIT,
  NOT_SIGNIFICANT_OPACITY,
  patternColour,
  projectGridToMercator,
  rateAlpha,
  sequentialColour,
  trendColour,
} from '../../maps/gridImage'
import './discovery.css'

// Vite's prebundled maplibre looks for the worker beside that bundle, where the file is not
// copied. Point at the package worker before any map is created. This stays inside Discovery.
setWorkerUrl(maplibreWorkerUrl)

const DEMO_STYLE_URL = 'https://demotiles.maplibre.org/style.json'
const GRID_COORDINATES: [[number, number], [number, number], [number, number], [number, number]] = [
  [-180, MERCATOR_LAT_LIMIT],
  [180, MERCATOR_LAT_LIMIT],
  [180, -MERCATOR_LAT_LIMIT],
  [-180, -MERCATOR_LAT_LIMIT],
]

/** Not a contract field. Fixed copy so the info panel can state the method. */
const METHOD_ONE_LINER =
  "Sen's slope and the Hamed–Rao modified Mann–Kendall test, then Benjamini–Hochberg FDR across evaluated cells."

/** Not a contract field. The 80% and 10-year rules are the published eligibility rule. */
const COVERAGE_NOTE =
  'Coverage is valid months divided by months in the window. A cell is evaluated only when valid months are at least 80% of the window and the window is at least 10 years; otherwise the class is insufficient data. Cells outside the common land mask are left transparent.'

const LAYERS = [
  { id: 'trend', label: 'Trend' },
  { id: 'rate', label: 'Rate of change' },
  { id: 'std', label: 'Standardized change' },
  { id: 'significance', label: 'Significance' },
  { id: 'pattern', label: 'Pattern (core)' },
  { id: 'coverage', label: 'Coverage' },
] as const

type LayerId = (typeof LAYERS)[number]['id']
type BasemapState = 'loading' | 'demo' | 'plain'
type LoadState = 'loading' | 'ready' | 'error'

interface Palette extends ClassPalette {
  divergingMid: Rgba
  sequentialLow: Rgba
  sequentialHigh: Rgba
}

interface GridBundle {
  key: string
  trend: Int8Array
  slope: Float32Array
  stdChange: Float32Array
  pValue: Float32Array
  qValue: Float32Array
  tau: Float32Array
  nValid: Float32Array
  coverage: Float32Array
  pattern: Int8Array
}

interface CellPick {
  row: number
  col: number
}

interface ClickState {
  regions: Region[]
  showRegions: boolean
  navigate: (page: 'region', opts: { selection: Selection }) => void
  setCell: (cell: CellPick) => void
}

interface RingCollection {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    properties: { id?: string; label?: string }
    geometry: { type: 'Polygon'; coordinates: number[][][] }
  }>
}

const FALLBACK_PALETTE: Palette = {
  increase: [192, 57, 43, 255],
  decrease: [36, 113, 163, 255],
  neutral: [200, 204, 210, 255],
  insufficientA: [213, 216, 222, 255],
  insufficientB: [154, 163, 175, 255],
  warmingDrying: [194, 65, 12, 255],
  warmingWetting: [15, 118, 110, 255],
  coolingDrying: [124, 58, 237, 255],
  coolingWetting: [3, 105, 161, 255],
  mixed: [107, 114, 128, 255],
  divergingMid: [244, 246, 248, 255],
  sequentialLow: [247, 251, 255, 255],
  sequentialHigh: [8, 64, 129, 255],
}

export default function DiscoveryPage() {
  const { index, variable, variableId, windowId, navigate, selection } = useApp()
  const [layer, setLayer] = useState<LayerId>('trend')
  const [showRegions, setShowRegions] = useState(false)
  const [regions, setRegions] = useState<Region[]>([])
  const [regionNote, setRegionNote] = useState<string | null>(null)
  const [grids, setGrids] = useState<GridBundle | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [palette, setPalette] = useState<Palette | null>(null)
  const [basemap, setBasemap] = useState<BasemapState>('loading')
  const [mapEpoch, setMapEpoch] = useState(0)
  const [cell, setCell] = useState<CellPick | null>(() =>
    selection?.kind === 'cell' ? { row: selection.row, col: selection.col } : null,
  )

  const rootRef = useRef<HTMLElement>(null)
  const mapNodeRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const cellNow = useRef(cell)
  const clickState = useRef<ClickState>({ regions: [], showRegions: false, navigate, setCell })
  cellNow.current = cell
  clickState.current = { regions, showRegions, navigate, setCell }

  const windowMeta = index.windows.find((item) => item.id === windowId)
  const temperatureLabel = variableLabel(index, index.pattern_pair.temperature)
  const moistureLabel = variableLabel(index, index.pattern_pair.moisture)
  const rateLimit = useMemo(() => (grids ? finiteAbsPercentile(grids.slope, 0.98) : null), [grids])
  const layerLabel = LAYERS.find((item) => item.id === layer)?.label ?? layer

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const read = () => setPalette(readPalette(root))
    read()
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', read)
    return () => media.removeEventListener('change', read)
  }, [])

  useEffect(() => {
    let cancelled = false
    loadRegions()
      .then((list) => {
        if (!cancelled) setRegions(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) setRegionNote(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const key = `${variableId}|${windowId}`
    setGrids(null)
    setLoadState('loading')
    setError(null)
    Promise.all([
      loadTrendClass(variableId, windowId),
      loadFloatLayer(variableId, windowId, 'sen_slope_decade'),
      loadFloatLayer(variableId, windowId, 'std_change_decade'),
      loadFloatLayer(variableId, windowId, 'p_value'),
      loadFloatLayer(variableId, windowId, 'q_value'),
      loadFloatLayer(variableId, windowId, 'mk_tau'),
      loadFloatLayer(variableId, windowId, 'n_valid'),
      loadFloatLayer(variableId, windowId, 'coverage'),
      loadPatternClass(windowId),
    ])
      .then(([trend, slope, stdChange, pValue, qValue, tau, nValid, coverage, pattern]) => {
        if (cancelled) return
        setGrids({ key, trend, slope, stdChange, pValue, qValue, tau, nValid, coverage, pattern })
        setLoadState('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setGrids(null)
        setLoadState('error')
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [variableId, windowId])

  useEffect(() => {
    const node = mapNodeRef.current
    const root = rootRef.current
    if (!node) return
    let cancelled = false
    let remoteReady = false
    let plainApplied = false
    const map = new MapLibreMap({
      container: node,
      style: DEMO_STYLE_URL,
      center: [0, 20],
      zoom: 1,
      renderWorldCopies: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: 0,
    })
    mapRef.current = map

    const mountOverlays = () => {
      ensureGrid(map)
      ensureRegions(map, clickState.current.regions, clickState.current.showRegions)
      ensureCell(map, cellNow.current)
      const canvas = canvasRef.current
      if (canvas) pushCanvas(map, canvas)
      if (!cancelled) setMapEpoch((value) => value + 1)
    }

    const usePlain = () => {
      if (remoteReady || plainApplied || cancelled) return
      plainApplied = true
      const background = root ? getComputedStyle(root).getPropertyValue('--bg').trim() || '#d5dde6' : '#d5dde6'
      map.setStyle(plainStyle(background))
      if (!cancelled) setBasemap('plain')
    }

    map.on('style.load', () => {
      if (!plainApplied) {
        remoteReady = true
        if (!cancelled) setBasemap('demo')
      }
      mountOverlays()
    })
    map.on('error', (event) => {
      const failure = (event as { error?: { message?: string; status?: number } }).error
      const message = failure?.message ?? ''
      const styleFailed = /demotiles\.maplibre\.org\/style\.json|Failed to load style/i.test(message)
      if (!remoteReady && styleFailed) usePlain()
    })
    const timer = window.setTimeout(() => {
      if (!remoteReady) usePlain()
    }, 10000)

    const onClick = (event: MapMouseEvent) => {
      const state = clickState.current
      const lon = normalizeLon(event.lngLat.lng)
      const lat = event.lngLat.lat
      if (state.showRegions) {
        const region = regionAt(lon, lat, state.regions)
        if (region) {
          state.navigate('region', { selection: { kind: 'region', regionId: region.id } })
          return
        }
      }
      const row = latToRow(lat)
      const col = lonToCol(lon)
      if (row < 0 || row >= N_ROWS || col < 0 || col >= N_COLS) return
      state.setCell({ row, col })
    }
    map.on('click', onClick)
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(node)
    requestAnimationFrame(() => map.resize())

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      observer.disconnect()
      map.off('click', onClick)
      map.remove()
      mapRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    if (!palette) return
    const image = grids ? projectGridToMercator(renderLayer(grids, layer, palette, index.q_threshold)) : null
    const canvas = image ? imageCanvas(image) : null
    canvasRef.current = canvas
    const map = mapRef.current
    if (!map || mapEpoch === 0 || !map.getLayer('grid-raster')) return
    if (!canvas) {
      map.setLayoutProperty('grid-raster', 'visibility', 'none')
      return
    }
    pushCanvas(map, canvas)
  }, [grids, palette, layer, mapEpoch, index.q_threshold])

  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0 || !map.getSource('regions')) return
    const source = geoJsonSource(map, 'regions')
    if (source) source.setData(regionCollection(regions))
    const visibility = showRegions ? 'visible' : 'none'
    if (map.getLayer('region-fill')) map.setLayoutProperty('region-fill', 'visibility', visibility)
    if (map.getLayer('region-line')) map.setLayoutProperty('region-line', 'visibility', visibility)
  }, [regions, showRegions, mapEpoch])

  useEffect(() => {
    const map = mapRef.current
    if (!map || mapEpoch === 0 || !map.getSource('cell')) return
    const source = geoJsonSource(map, 'cell')
    if (source) source.setData(cell ? cellCollection(cell) : emptyCollection())
  }, [cell, mapEpoch])

  return (
    <section className="discovery" ref={rootRef}>
      <div className="discovery-body">
        <div className="discovery-map">
          <div ref={mapNodeRef} className="discovery-map-canvas" aria-label="World map of the selected variable" />
          {loadState === 'loading' ? (
            <div className="discovery-status" role="status">
              <div className="discovery-spinner" />
              <span>Loading layer…</span>
            </div>
          ) : null}
          {loadState === 'error' ? (
            <div className="discovery-status discovery-status-error" role="alert">
              <strong>This layer failed to load.</strong>
              <span>{error}</span>
            </div>
          ) : null}
        </div>
        <div className="discovery-panels">
          <section className="discovery-card">
            <h2>{layerLabel}</h2>
            <p className="discovery-muted">
              {variable.label}, {windowMeta ? `${windowMeta.start} to ${windowMeta.end}` : windowId}
            </p>
            <div className="discovery-layers" role="radiogroup" aria-label="Map layer">
              {LAYERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={layer === item.id}
                  onClick={() => setLayer(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>
          <Legend
            layer={layer}
            palette={palette ?? FALLBACK_PALETTE}
            variableUnit={variable.display_unit}
            increaseMeans={variable.increase_means}
            qThreshold={index.q_threshold}
            rateLimit={rateLimit}
            temperatureLabel={temperatureLabel}
            moistureLabel={moistureLabel}
          />
          <CellPanel
            cell={cell}
            grids={grids}
            loadState={loadState}
            variable={variable}
            months={index.months}
            windowMeta={windowMeta}
            qThreshold={index.q_threshold}
            temperatureLabel={temperatureLabel}
            moistureLabel={moistureLabel}
            onInspect={() => {
              if (!cell) return
              navigate('region', { selection: { kind: 'cell', row: cell.row, col: cell.col } })
            }}
          />
          <section className="discovery-card">
            <h2>Regions</h2>
            <label className="discovery-check">
              <input
                type="checkbox"
                checked={showRegions}
                onChange={(event) => setShowRegions(event.target.checked)}
              />
              Show region outlines
            </label>
            <p className="discovery-muted">
              Boxes are approximate. With outlines on, a click inside a box opens that region. Turn outlines off to
              inspect a cell inside a box. Overlapping boxes open the smaller one.
            </p>
            {regionNote ? <p role="alert">{regionNote}</p> : null}
            <ul className="discovery-regions">
              {regions.map((region) => (
                <li key={region.id}>
                  <button
                    type="button"
                    onClick={() => navigate('region', { selection: { kind: 'region', regionId: region.id } })}
                  >
                    {region.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <InfoPanel
            variable={variable}
            basemap={basemap}
            temperatureLabel={temperatureLabel}
            moistureLabel={moistureLabel}
            patternLayer={layer === 'pattern'}
          />
        </div>
      </div>
    </section>
  )
}

function Legend({
  layer,
  palette,
  variableUnit,
  increaseMeans,
  qThreshold,
  rateLimit,
  temperatureLabel,
  moistureLabel,
}: {
  layer: LayerId
  palette: Palette
  variableUnit: string
  increaseMeans: string
  qThreshold: number
  rateLimit: number | null
  temperatureLabel: string
  moistureLabel: string
}) {
  return (
    <section className="discovery-card discovery-legend">
      <h2>Legend</h2>
      <p>
        Display unit: {variableUnit}.
        {layer === 'rate' ? ` Sen slope: ${variableUnit} per decade.` : null}
        {layer === 'std' ? ' Standardized change: standard deviations per decade.' : null}
        {layer === 'significance' ? ' Significance is an FDR-adjusted q value from 0 to 1.' : null}
        {layer === 'coverage' ? ' Coverage is a fraction of valid months from 0 to 1.' : null}
        {layer === 'trend' ? ' Trend classes describe direction, not a rate.' : null}
        {layer === 'pattern' ? ` Pattern classes compare ${temperatureLabel} and ${moistureLabel}.` : null}
      </p>
      {layer === 'trend' ? (
        <ul>
          <Swatch colour={palette.increase} text={`Significant increase (${increaseMeans})`} />
          <Swatch colour={palette.decrease} text="Significant decrease" />
          <Swatch colour={palette.neutral} text="Not significant" />
          <Swatch hatch={palette} text="Insufficient data" />
          <Swatch text="Outside domain (transparent)" />
        </ul>
      ) : null}
      {layer === 'rate' && rateLimit != null ? (
        <>
          <Ramp left={palette.decrease} mid={palette.divergingMid} right={palette.increase} />
          <p className="discovery-muted">
            Symmetric limits ±{formatStat(rateLimit)} {variableUnit} per decade. The limit is the 98th percentile of
            absolute values over finite cells, including cells that are not significant. Not-significant finite cells
            are drawn at {Math.round(NOT_SIGNIFICANT_OPACITY * 100)}% opacity.
          </p>
        </>
      ) : null}
      {layer === 'std' ? (
        <>
          <Ramp left={palette.decrease} mid={palette.divergingMid} right={palette.increase} />
          <p className="discovery-muted">Colour scale fixed at ±2 standard deviations per decade.</p>
        </>
      ) : null}
      {layer === 'significance' ? (
        <>
          <ThresholdRamp low={palette.sequentialHigh} high={palette.sequentialLow} threshold={qThreshold} />
          <p className="discovery-muted">
            Left is q = 0 (stronger evidence). Right is q = 1. The marker is the index threshold q = {qThreshold}.
          </p>
        </>
      ) : null}
      {layer === 'coverage' ? (
        <>
          <ThresholdRamp low={palette.sequentialLow} high={palette.sequentialHigh} threshold={null} />
          <p className="discovery-muted">Left is 0. Right is 1.</p>
        </>
      ) : null}
      {layer === 'pattern' ? (
        <ul>
          <Swatch colour={palette.warmingDrying} text={patternWords(PATTERN_WARMING_DRYING, temperatureLabel, moistureLabel)} />
          <Swatch colour={palette.warmingWetting} text={patternWords(PATTERN_WARMING_WETTING, temperatureLabel, moistureLabel)} />
          <Swatch colour={palette.coolingDrying} text={patternWords(PATTERN_COOLING_DRYING, temperatureLabel, moistureLabel)} />
          <Swatch colour={palette.coolingWetting} text={patternWords(PATTERN_COOLING_WETTING, temperatureLabel, moistureLabel)} />
          <Swatch colour={palette.mixed} text={patternWords(PATTERN_MIXED, temperatureLabel, moistureLabel)} />
          <Swatch hatch={palette} text={patternWords(INSUFFICIENT_DATA, temperatureLabel, moistureLabel)} />
          <Swatch text="Outside domain (transparent)" />
        </ul>
      ) : null}
      <p>FDR-adjusted q {'<'} 0.05</p>
      <p>not significant ≠ no change</p>
    </section>
  )
}

function Swatch({ colour, hatch, text }: { colour?: Rgba; hatch?: Palette; text: string }) {
  const style = hatch
    ? {
        background: `repeating-linear-gradient(45deg, ${cssRgba(hatch.insufficientA)} 0 4px, ${cssRgba(hatch.insufficientB)} 4px 8px)`,
      }
    : colour
      ? { background: cssRgba(colour) }
      : undefined
  return (
    <li>
      <span className="discovery-swatch" style={style} />
      <span>{text}</span>
    </li>
  )
}

function Ramp({ left, mid, right }: { left: Rgba; mid: Rgba; right: Rgba }) {
  return (
    <div
      className="discovery-ramp"
      style={{ background: `linear-gradient(90deg, ${cssRgba(left)}, ${cssRgba(mid)}, ${cssRgba(right)})` }}
    />
  )
}

function ThresholdRamp({ low, high, threshold }: { low: Rgba; high: Rgba; threshold: number | null }) {
  return (
    <div className="discovery-ramp" style={{ background: `linear-gradient(90deg, ${cssRgba(low)}, ${cssRgba(high)})` }}>
      {threshold != null ? (
        <span className="discovery-tick" style={{ left: `${Math.min(100, Math.max(0, threshold * 100))}%` }}>
          <span>q = {threshold}</span>
        </span>
      ) : null}
    </div>
  )
}

function CellPanel({
  cell,
  grids,
  loadState,
  variable,
  months,
  windowMeta,
  qThreshold,
  temperatureLabel,
  moistureLabel,
  onInspect,
}: {
  cell: CellPick | null
  grids: GridBundle | null
  loadState: LoadState
  variable: DataIndex['variables'][number]
  months: string[]
  windowMeta: DataIndex['windows'][number] | undefined
  qThreshold: number
  temperatureLabel: string
  moistureLabel: string
  onInspect: () => void
}) {
  const values = cell && grids ? readCell(grids, cell) : null
  const monthCount = windowMeta ? monthsInWindow(months, windowMeta.start, windowMeta.end) : null
  return (
    <section className="discovery-card">
      <h2>Cell</h2>
      {cell == null ? (
        <p>Click a cell to read its trend, slope, and significance in words.</p>
      ) : (
        <>
          <dl className="discovery-facts">
            <dt>Latitude</dt>
            <dd>{formatLatitude(rowToLat(cell.row))} (cell centre, row {cell.row})</dd>
            <dt>Longitude</dt>
            <dd>{formatLongitude(colToLon(cell.col))} (cell centre, column {cell.col})</dd>
            <dt>Trend class</dt>
            <dd>{values ? trendWords(values.trend, variable.increase_means) : loadState === 'error' ? 'Unavailable' : 'Loading…'}</dd>
            <dt>Sen slope per decade</dt>
            <dd>
              {values ? formatStat(values.slope) : '—'} {variable.display_unit} per decade
            </dd>
            <dt>p</dt>
            <dd>{values ? formatStat(values.p) : '—'}</dd>
            <dt>q</dt>
            <dd>
              {values ? formatStat(values.q) : '—'}
              {values && Number.isFinite(values.q)
                ? values.q < qThreshold
                  ? ' (below the FDR threshold)'
                  : ' (not below the FDR threshold)'
                : ''}
            </dd>
            <dt>τ</dt>
            <dd>{values ? formatStat(values.tau) : '—'}</dd>
            <dt>Valid months</dt>
            <dd>
              {values ? formatCount(values.nValid) : '—'}
              {monthCount != null ? ` of ${monthCount}` : ''}
            </dd>
            <dt>Coverage</dt>
            <dd>{values ? formatStat(values.coverage) : '—'}</dd>
            <dt>Product</dt>
            <dd>{variable.product}</dd>
            <dt>Source variable</dt>
            <dd>{variable.source_variable}</dd>
            {values ? (
              <>
                <dt>Pattern class</dt>
                <dd>{patternWords(values.pattern, temperatureLabel, moistureLabel)}</dd>
              </>
            ) : null}
          </dl>
          <button type="button" className="discovery-primary" onClick={onInspect}>
            Inspect evidence
          </button>
        </>
      )}
    </section>
  )
}

function InfoPanel({
  variable,
  basemap,
  temperatureLabel,
  moistureLabel,
  patternLayer,
}: {
  variable: DataIndex['variables'][number]
  basemap: BasemapState
  temperatureLabel: string
  moistureLabel: string
  patternLayer: boolean
}) {
  return (
    <section className="discovery-card">
      <h2>Dataset</h2>
      <dl className="discovery-facts">
        <dt>Dataset</dt>
        <dd>{variable.product}</dd>
        <dt>Product version</dt>
        <dd>{variable.product_version}</dd>
        <dt>DOI</dt>
        <dd>
          {variable.doi ? (
            <a href={doiHref(variable.doi)} target="_blank" rel="noreferrer">
              {variable.doi}
            </a>
          ) : (
            'None listed'
          )}
        </dd>
      </dl>
      <p>{METHOD_ONE_LINER}</p>
      <p>{COVERAGE_NOTE}</p>
      <p>
        Registry slope unit: {variable.slope_unit}. The rate layer is labelled {variable.display_unit} per decade.
      </p>
      <h3>Caveats</h3>
      {variable.caveats.length > 0 ? (
        <ul>
          {variable.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      ) : (
        <p>No caveats are listed for this variable.</p>
      )}
      {patternLayer ? (
        <p>
          The pattern layer follows {temperatureLabel} and {moistureLabel} for this window. It does not follow the
          variable selected in the header.
        </p>
      ) : null}
      <p>
        Web Mercator cannot show beyond about ±85° latitude, so the polar rows of this 90° to −90° grid are clipped.
        The raster is pinned to ±85.05° because MapLibre cannot tile an image corner at ±90°, and each row is
        placed at its Web Mercator latitude. A clicked cell uses its true centre.
      </p>
      <p className="discovery-muted">
        Basemap: {DEMO_STYLE_URL}.{' '}
        {basemap === 'demo'
          ? 'Demo tiles are loaded.'
          : basemap === 'plain'
            ? 'That style did not load, so the map is using a plain background.'
            : 'Waiting for the demo style.'}
      </p>
    </section>
  )
}

function renderLayer(grids: GridBundle, layer: LayerId, palette: Palette, qThreshold: number): ImageData {
  if (layer === 'trend') return gridImage(grids.trend, (value, index) => trendColour(value, palette, index))
  if (layer === 'pattern') return gridImage(grids.pattern, (value, index) => patternColour(value, palette, index))
  if (layer === 'rate') {
    const limit = finiteAbsPercentile(grids.slope, 0.98)
    return gridImage(grids.slope, (value, index) =>
      divergingColour(value, limit, palette.decrease, palette.increase, palette.divergingMid, rateAlpha(grids.qValue[index], qThreshold)),
    )
  }
  if (layer === 'std') {
    return gridImage(grids.stdChange, (value) =>
      divergingColour(value, 2, palette.decrease, palette.increase, palette.divergingMid, 255),
    )
  }
  if (layer === 'significance') {
    return gridImage(grids.qValue, (value) => sequentialColour(value, palette.sequentialHigh, palette.sequentialLow))
  }
  return gridImage(grids.coverage, (value) => sequentialColour(value, palette.sequentialLow, palette.sequentialHigh))
}

function imageCanvas(image: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Could not draw the grid image.')
  context.putImageData(image, 0, 0)
  return canvas
}

function readCell(grids: GridBundle, cell: CellPick) {
  const index = cellIndex(cell.row, cell.col)
  return {
    trend: grids.trend[index],
    slope: grids.slope[index],
    p: grids.pValue[index],
    q: grids.qValue[index],
    tau: grids.tau[index],
    nValid: grids.nValid[index],
    coverage: grids.coverage[index],
    pattern: grids.pattern[index],
  }
}

function trendWords(code: number, increaseMeans: string): string {
  if (code === TREND_INCREASE) return `Significant increase (${increaseMeans})`
  if (code === TREND_DECREASE) return 'Significant decrease'
  if (code === TREND_NOT_SIGNIFICANT) return 'Not significant'
  if (code === INSUFFICIENT_DATA) return 'Insufficient data'
  if (code === OUTSIDE_DOMAIN) return 'Outside domain'
  return `Unknown class (${code})`
}

function patternWords(code: number, temperature: string, moisture: string): string {
  if (code === PATTERN_WARMING_DRYING) return `${temperature} increase, ${moisture} decrease`
  if (code === PATTERN_WARMING_WETTING) return `${temperature} increase, ${moisture} increase`
  if (code === PATTERN_COOLING_DRYING) return `${temperature} decrease, ${moisture} decrease`
  if (code === PATTERN_COOLING_WETTING) return `${temperature} decrease, ${moisture} increase`
  if (code === PATTERN_MIXED) return 'Mixed or inconclusive'
  if (code === INSUFFICIENT_DATA) return 'Insufficient data'
  if (code === OUTSIDE_DOMAIN) return 'Outside domain'
  return `Unknown pattern (${code})`
}

function variableLabel(index: DataIndex, id: string): string {
  return index.variables.find((item) => item.id === id)?.label ?? id
}

function monthsInWindow(months: string[], start: string, end: string): number {
  return months.filter((month) => month >= start && month <= end).length
}

function formatStat(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  if (absolute !== 0 && (absolute < 0.001 || absolute >= 100000)) return value.toExponential(2)
  return String(Number(value.toPrecision(3)))
}

function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return String(Math.round(value))
}

function formatLatitude(value: number): string {
  const hemisphere = value > 0 ? 'N' : value < 0 ? 'S' : ''
  return `${Math.abs(value).toFixed(1)}°${hemisphere}`
}

function formatLongitude(value: number): string {
  const hemisphere = value > 0 ? 'E' : value < 0 ? 'W' : ''
  return `${Math.abs(value).toFixed(1)}°${hemisphere}`
}

function doiHref(doi: string): string {
  if (/^https?:\/\//i.test(doi)) return doi
  return `https://doi.org/${doi}`
}

function cssRgba(colour: Rgba): string {
  return `rgba(${Math.round(colour[0])}, ${Math.round(colour[1])}, ${Math.round(colour[2])}, ${(colour[3] / 255).toFixed(3)})`
}

function readPalette(root: HTMLElement): Palette {
  const style = getComputedStyle(root)
  const pick = (name: string, fallback: Rgba) => parseCssColour(style.getPropertyValue(name), fallback)
  return {
    increase: pick('--increase', FALLBACK_PALETTE.increase),
    decrease: pick('--decrease', FALLBACK_PALETTE.decrease),
    neutral: pick('--neutral', FALLBACK_PALETTE.neutral),
    insufficientA: pick('--insuf-a', FALLBACK_PALETTE.insufficientA),
    insufficientB: pick('--insuf-b', FALLBACK_PALETTE.insufficientB),
    warmingDrying: pick('--pat-wd', FALLBACK_PALETTE.warmingDrying),
    warmingWetting: pick('--pat-ww', FALLBACK_PALETTE.warmingWetting),
    coolingDrying: pick('--pat-cd', FALLBACK_PALETTE.coolingDrying),
    coolingWetting: pick('--pat-cw', FALLBACK_PALETTE.coolingWetting),
    mixed: pick('--pat-mixed', FALLBACK_PALETTE.mixed),
    divergingMid: pick('--div-mid', FALLBACK_PALETTE.divergingMid),
    sequentialLow: pick('--seq-low', FALLBACK_PALETTE.sequentialLow),
    sequentialHigh: pick('--seq-high', FALLBACK_PALETTE.sequentialHigh),
  }
}

function parseCssColour(input: string, fallback: Rgba): Rgba {
  const value = input.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const raw = hex[1]
    const full = raw.length === 3 ? raw.split('').map((part) => part + part).join('') : raw
    const parsed = Number.parseInt(full, 16)
    return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255, 255]
  }
  const rgb = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i.exec(value)
  if (!rgb) return fallback
  const alpha = rgb[4] == null ? 255 : Number(rgb[4]) <= 1 ? Math.round(Number(rgb[4]) * 255) : Number(rgb[4])
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha]
}

function plainStyle(background: string): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': background } }],
  }
}

function normalizeLon(lon: number): number {
  const wrapped = (((lon + 180) % 360) + 360) % 360 - 180
  return wrapped === 180 ? -180 : wrapped
}

function regionAt(lon: number, lat: number, regions: Region[]): Region | null {
  let best: Region | null = null
  let bestArea = Number.POSITIVE_INFINITY
  for (const region of regions) {
    const [west, south, east, north] = region.bbox
    if (lon < west || lon > east || lat < south || lat > north) continue
    const area = Math.abs(east - west) * Math.abs(north - south)
    if (area < bestArea) {
      best = region
      bestArea = area
    }
  }
  return best
}

function ring(west: number, south: number, east: number, north: number): number[][][] {
  return [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ]
}

function emptyCollection(): RingCollection {
  return { type: 'FeatureCollection', features: [] }
}

function regionCollection(regions: Region[]): RingCollection {
  return {
    type: 'FeatureCollection',
    features: regions.map((region) => {
      const [west, south, east, north] = region.bbox
      return {
        type: 'Feature',
        properties: { id: region.id, label: region.label },
        geometry: { type: 'Polygon', coordinates: ring(west, south, east, north) },
      }
    }),
  }
}

function cellCollection(cell: CellPick): RingCollection {
  const north = 90 - cell.row
  const south = north - 1
  const west = -180 + cell.col
  const east = west + 1
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: ring(west, south, east, north) },
      },
    ],
  }
}

function ensureGrid(map: MapLibreMap) {
  if (map.getSource('grid')) return
  map.addSource('grid', { type: 'image', coordinates: GRID_COORDINATES })
  map.addLayer({
    id: 'grid-raster',
    type: 'raster',
    source: 'grid',
    layout: { visibility: 'none' },
    paint: { 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
  })
}

function ensureRegions(map: MapLibreMap, regions: Region[], showRegions: boolean) {
  if (map.getSource('regions')) return
  map.addSource('regions', { type: 'geojson', data: regionCollection(regions) })
  const visibility = showRegions ? 'visible' : 'none'
  map.addLayer({
    id: 'region-fill',
    type: 'fill',
    source: 'regions',
    layout: { visibility },
    paint: { 'fill-color': '#f4a261', 'fill-opacity': 0.08 },
  })
  map.addLayer({
    id: 'region-line',
    type: 'line',
    source: 'regions',
    layout: { visibility },
    paint: { 'line-color': '#c2410c', 'line-width': 2 },
  })
}

function ensureCell(map: MapLibreMap, cell: CellPick | null) {
  if (map.getSource('cell')) return
  map.addSource('cell', { type: 'geojson', data: cell ? cellCollection(cell) : emptyCollection() })
  map.addLayer({
    id: 'cell-casing',
    type: 'line',
    source: 'cell',
    paint: { 'line-color': '#ffffff', 'line-width': 4 },
  })
  map.addLayer({
    id: 'cell-line',
    type: 'line',
    source: 'cell',
    paint: { 'line-color': '#1b1f24', 'line-width': 2 },
  })
}

function geoJsonSource(map: MapLibreMap, id: string): GeoJSONSource | null {
  const source = map.getSource(id)
  if (source && source.type === 'geojson') return source as GeoJSONSource
  return null
}

function pushCanvas(map: MapLibreMap, canvas: HTMLCanvasElement) {
  const source = map.getSource('grid')
  if (!source || source.type !== 'image') return
  const imageSource = source as ImageSource
  imageSource.updateImage({ image: canvas })
  if (map.getLayer('grid-raster')) map.setLayoutProperty('grid-raster', 'visibility', 'visible')
}
