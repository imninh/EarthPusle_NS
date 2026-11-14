import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import {
  AttributionControl,
  GeoJSONSource,
  ImageSource,
  Map as MapLibreMap,
  NavigationControl,
  type MapMouseEvent,
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
  QUALITY_STEP,
  QUALITY_STEP_KNOWN_FORCING,
  TREND_DECREASE,
  TREND_INCREASE,
  TREND_NOT_SIGNIFICANT,
  WITNESS_CONTRADICTED,
  WITNESS_CORROBORATED,
  WITNESS_MAIN_NOT_SIGNIFICANT,
  WITNESS_OPPOSITE_SIGN,
  WITNESS_SAME_SIGN,
  cellIndex,
  colToLon,
  latToRow,
  lonToCol,
  rowToLat,
} from '../../data/contract'
import { useApp } from '../../data/AppState'
import {
  loadBreakpointYear,
  loadCountries,
  loadFloatLayer,
  loadPatternClass,
  loadQualityFlag,
  loadRegions,
  loadTrendClass,
  loadWitnessAgreement,
  loadWitnessStdChange,
} from '../../data/loaders'
import type { Country, DataIndex, Region, Selection } from '../../data/types'
import { PlaceSearch } from '../../components/PlaceSearch'
import { Disclosure, Exhibit, HelpTip, VerdictStamp } from '../../components/ui'
import { GLOSSARY, VERDICT_LABELS, formatUnit, plainVerdict } from '../../lib/format'
import {
  type ClassPalette,
  type Rgba,
  divergingColour,
  finiteAbsPercentile,
  MERCATOR_LAT_LIMIT,
  NOT_SIGNIFICANT_OPACITY,
  patternColour,
  sequentialColour,
  trendColour,
} from '../../maps/gridImage'
import {
  PIXELS_PER_DEG,
  clipImageToLand,
  projectEquirectToMercator,
  renderClassImage,
  renderContinuousImage,
  renderQualityImage,
} from '../../maps/renderGrid'
import {
  combinedQualityWitness,
  WITNESS_PALETTE,
  witnessColour,
  witnessWords,
} from '../../maps/witness'
import {
  applyNightBasemapTheme,
  buildNightBasemapStyle,
  loadNaturalEarth,
  type BasemapData,
} from '../../maps/basemap'
import {
  VERDICT_MARKER,
  VERDICT_NOT_YET,
  VERDICT_STRIPE,
  VERDICT_WORDS,
  applyContradictedStripes,
  verdictClass,
  verdictClassWords,
  verdictColour,
  verdictGrid,
} from '../../maps/verdict'
import { type LayerId, isLayerId, resolveLayer } from './layers'
import './discovery.css'

// Vite's prebundled maplibre looks for the worker beside that bundle, where the file is not
// copied. Point at the package worker before any map is created. This stays inside Discovery.
setWorkerUrl(maplibreWorkerUrl)

/** Not a contract field. Fixed copy so the info panel can state the method. */
const METHOD_ONE_LINER =
  "Sen's slope and the Hamed–Rao modified Mann–Kendall test, then Benjamini–Hochberg FDR across evaluated cells."

/** Not a contract field. The 80% and 10-year rules are the published eligibility rule. */
const COVERAGE_NOTE =
  'Coverage is valid months divided by months in the window. A cell is evaluated only when valid months are at least 80% of the window and the window is at least 10 years; otherwise the class is insufficient data. Cells outside the common land mask are left transparent.'

const VERDICT_LAYER = { id: 'verdict', label: 'Verdict' } as const
const BASE_LAYERS = [
  { id: 'trend', label: 'Trend' },
  { id: 'rate', label: 'Rate of change' },
  { id: 'std', label: 'Standardized change' },
  { id: 'significance', label: 'Significance' },
  { id: 'pattern', label: 'Pattern (core)' },
  { id: 'coverage', label: 'Coverage' },
] as const
const QUALITY_LAYER = { id: 'quality', label: 'Data quality' } as const
const WITNESS_LAYER = { id: 'witness', label: 'Second witness' } as const
/** Layers that stay under "More layers" until the user opens it. */
const MORE_LAYER_IDS: readonly LayerId[] = ['std', 'significance', 'pattern', 'coverage']

/**
 * One-line explanations for the layers that need a definition. Significance, data
 * quality and second witness come from the shared P19 glossary; the standardized
 * change sentence is local because the glossary has no TermId for it yet.
 */
const LAYER_HELP: Partial<Record<LayerId, { label: string; text: string }>> = {
  verdict: {
    label: 'Verdict',
    text: 'One map of the whole idea: where a trend is significant and clean, where a sudden shift is flagged, where a second dataset disagrees, and where there is only a direction so far.',
  },
  std: {
    label: 'Standardized change',
    text: 'Change measured in units of this variable’s own year-to-year variability, so different variables can be compared.',
  },
  significance: { label: 'Significance', text: GLOSSARY.q_value.plain },
  quality: { label: 'Data quality', text: GLOSSARY.sudden_shift.plain },
  witness: { label: 'Second witness', text: GLOSSARY.second_witness.plain },
}

type Projection = 'globe' | 'mercator'
type BasemapState = 'loading' | 'ready' | 'error'
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
  quality: Int8Array | null
  breakYear: Float32Array | null
  witness: Int8Array | null
  witnessStd: Float32Array | null
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

interface HoverState {
  x: number
  y: number
  title: string
  detail: string
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

const CANVAS_CACHE_LIMIT = 8

export default function DiscoveryPage() {
  const { index, variable, variableId, windowId, navigate, selection, mapLayer } = useApp()
  const [layerChoice, setLayerChoice] = useState<LayerId | null>(() =>
    isLayerId(mapLayer) && (mapLayer !== 'witness' || index.witness) ? mapLayer : null,
  )
  const [projection, setProjection] = useState<Projection>('globe')
  const [showRegions, setShowRegions] = useState(false)
  const [regions, setRegions] = useState<Region[]>([])
  const [countries, setCountries] = useState<Country[]>([])
  const [regionNote, setRegionNote] = useState<string | null>(null)
  const [grids, setGrids] = useState<GridBundle | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [palette, setPalette] = useState<Palette | null>(null)
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [basemapData, setBasemapData] = useState<BasemapData | null>(null)
  const [basemapState, setBasemapState] = useState<BasemapState>('loading')
  const [basemapError, setBasemapError] = useState<string | null>(null)
  const [mapEpoch, setMapEpoch] = useState(0)
  const [stageHeight, setStageHeight] = useState<number | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [pickedPlace, setPickedPlace] = useState<{ id: string; label: string; bbox: [number, number, number, number] } | null>(null)
  const [cell, setCell] = useState<CellPick | null>(() =>
    selection?.kind === 'cell' ? { row: selection.row, col: selection.col } : null,
  )

  const rootRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const nightRef = useRef<HTMLDivElement>(null)
  const mapNodeRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasCache = useRef(new Map<string, HTMLCanvasElement>())
  const cellNow = useRef(cell)
  const darkNow = useRef(dark)
  const clickState = useRef<ClickState>({ regions: [], showRegions: false, navigate, setCell })
  const interaction = useRef<{
    grids: GridBundle | null
    layer: LayerId
    variable: DataIndex['variables'][number]
    qThreshold: number
  }>({ grids: null, layer: 'trend', variable, qThreshold: index.q_threshold })
  const activeLayer: LayerId = resolveLayer({
    choice: layerChoice,
    verdictByDefault: Boolean(index.quality) && Boolean(index.witness?.products[variableId]),
    loaded: grids != null,
    hasQuality: grids?.quality != null,
    hasWitness: grids?.witness != null,
  })
  cellNow.current = cell
  darkNow.current = dark
  clickState.current = { regions, showRegions, navigate, setCell }
  interaction.current = { grids, layer: activeLayer, variable, qThreshold: index.q_threshold }

  const windowMeta = index.windows.find((item) => item.id === windowId)
  const temperatureLabel = variableLabel(index, index.pattern_pair.temperature)
  const moistureLabel = variableLabel(index, index.pattern_pair.moisture)
  const rateLimit = useMemo(() => (grids ? finiteAbsPercentile(grids.slope, 0.98) : null), [grids])
  const qualityAvailable = Boolean(index.quality) && grids?.quality != null
  const witnessAvailable = Boolean(index.witness) && grids?.witness != null
  // A variable published without a witness product keeps its button, disabled: the
  // absence is information (P22 task 6). The layer is hidden only when the export has
  // no witness section at all.
  const witnessListed = Boolean(index.witness?.products[variableId])
  const witnessMissing = Boolean(index.witness) && !witnessListed
  const displayUnit = formatUnit(variable.display_unit)
  const verdictAvailable = qualityAvailable || witnessAvailable
  const layers: ReadonlyArray<{ id: LayerId; label: string }> = [
    ...(verdictAvailable || grids == null ? [VERDICT_LAYER] : []),
    ...BASE_LAYERS,
    ...(qualityAvailable ? [QUALITY_LAYER] : []),
    ...(index.witness ? [WITNESS_LAYER] : []),
  ]
  const layerLabel = layers.find((item) => item.id === activeLayer)?.label ?? activeLayer

  function pickPlace(place: { kind: 'region'; regionId: string }): void {
    const country = countries.find((item) => item.id === place.regionId)
    const region = regions.find((item) => item.id === place.regionId)
    const found = country ?? region
    if (!found) return
    const [west, south, east, north] = found.bbox
    setPickedPlace({ id: found.id, label: found.label, bbox: found.bbox })
    mapRef.current?.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 70, duration: 900, maxZoom: 6 },
    )
  }

  useLayoutEffect(() => {
    const root = nightRef.current ?? rootRef.current
    if (!root) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const read = () => {
      setPalette(readPalette(root))
      setDark(media.matches)
    }
    read()
    media.addEventListener('change', read)
    return () => media.removeEventListener('change', read)
  }, [])

  // The stage must end at the viewport bottom: the header and the context bar change height
  // at 760 px and when a variable's description wraps, so measure instead of guessing.
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    let frame = 0
    let cancelled = false
    const measure = () => {
      frame = 0
      if (cancelled) return
      const documentTop = stage.getBoundingClientRect().top + window.scrollY
      setStageHeight(Math.max(520, Math.round(window.innerHeight - documentTop)))
    }
    const schedule = () => {
      if (!cancelled && frame === 0) frame = requestAnimationFrame(measure)
    }
    schedule()
    window.addEventListener('resize', schedule)
    document.fonts?.ready.then(schedule).catch(() => undefined)
    return () => {
      cancelled = true
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
    }
  }, [variableId, windowId])

  useEffect(() => {
    let cancelled = false
    loadNaturalEarth()
      .then((data) => {
        if (cancelled) return
        setBasemapData(data)
        setBasemapState('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setBasemapState('error')
        setBasemapError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([loadRegions(), loadCountries()])
      .then(([regionList, countryList]) => {
        if (cancelled) return
        setRegions(regionList)
        setCountries(countryList)
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
    setLoadState('loading')
    setError(null)
    const quality = Promise.all([
      loadQualityFlag(variableId, windowId),
      loadBreakpointYear(variableId, windowId),
    ]).catch(() => [null, null] as const)
    const witness = Promise.all([
      loadWitnessAgreement(variableId, windowId),
      loadWitnessStdChange(variableId, windowId),
    ]).catch(() => [null, null] as const)
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
      quality,
      witness,
    ])
      .then(([trend, slope, stdChange, pValue, qValue, tau, nValid, coverage, pattern, extraQuality, extraWitness]) => {
        if (cancelled) return
        const [qualityFlag, breakYear] = extraQuality
        const [witnessAgreement, witnessStd] = extraWitness
        setGrids({
          key,
          trend,
          slope,
          stdChange,
          pValue,
          qValue,
          tau,
          nValid,
          coverage,
          pattern,
          quality: qualityFlag,
          breakYear,
          witness: witnessAgreement,
          witnessStd,
        })
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
    if (!node || !basemapData) return
    let cancelled = false
    const map = new MapLibreMap({
      container: node,
      style: buildNightBasemapStyle(darkNow.current, basemapData.land, basemapData.borders, projection),
      center: [15, 18],
      zoom: 2.0,
      renderWorldCopies: false,
      dragRotate: true,
      pitchWithRotate: true,
      touchPitch: true,
      fadeDuration: 0,
      attributionControl: false,
    })
    mapRef.current = map
    map.addControl(new AttributionControl({ compact: true, customAttribution: 'Natural Earth' }), 'bottom-right')
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')

    const mountOverlays = () => {
      if (cancelled) return
      applyNightBasemapTheme(map, darkNow.current)
      ensureGrid(map)
      ensureRegions(map, clickState.current.regions, clickState.current.showRegions)
      ensureCell(map, cellNow.current)
      const canvas = canvasRef.current
      if (canvas) pushCanvas(map, canvas)
      setMapEpoch((value) => value + 1)
    }

    map.on('style.load', mountOverlays)
    map.on('error', (event) => {
      const message = (event as { error?: { message?: string } }).error?.message
      if (message) setBasemapError(message)
    })

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

    const onMove = (event: MapMouseEvent) => {
      const state = interaction.current
      const lon = normalizeLon(event.lngLat.lng)
      const lat = event.lngLat.lat
      const row = latToRow(lat)
      const col = lonToCol(lon)
      if (!state.grids || row < 0 || row >= N_ROWS || col < 0 || col >= N_COLS) {
        setHover(null)
        return
      }
      const index = cellIndex(row, col)
      const grids = state.grids
      const title = `${formatLatitude(rowToLat(row))}, ${formatLongitude(colToLon(col))}`
      const detail = hoverDetail(state.layer, grids, index, state.variable)
      setHover({ x: event.point.x, y: event.point.y, title, detail })
    }
    const onLeave = () => setHover(null)

    map.on('click', onClick)
    map.on('mousemove', onMove)
    map.on('mouseout', onLeave)
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(node)
    requestAnimationFrame(() => map.resize())

    return () => {
      cancelled = true
      observer.disconnect()
      map.off('click', onClick)
      map.off('mousemove', onMove)
      map.off('mouseout', onLeave)
      map.remove()
      mapRef.current = null
    }
  }, [basemapData, projection])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    applyNightBasemapTheme(map, dark)
  }, [dark])

  useLayoutEffect(() => {
    const map = mapRef.current
    if (!map || (!grids && !canvasRef.current)) return
    if (!grids || !palette || !basemapData) {
      if (map.getLayer('grid-raster')) map.setLayoutProperty('grid-raster', 'visibility', 'none')
      return
    }
    const usedLayer: LayerId = activeLayer
    const key = `${grids.key}|${usedLayer}|${dark}`
    let canvas = canvasCache.current.get(key)
    if (!canvas) {
      const image = buildLayerImage(grids, usedLayer, palette, index.q_threshold)
      const clipped = clipImageToLand(image, basemapData.land)
      // MapLibre image sources are textured in Mercator space in both globe
      // and flat projections, so warp once here. This keeps the raster aligned
      // with the Natural Earth basemap and prevents colour bleeding over ocean.
      canvas = imageCanvas(projectEquirectToMercator(imageDataFromCanvas(clipped)))
      rememberCanvas(canvasCache.current, key, canvas)
    }
    canvasRef.current = canvas
    if (map.getLayer('grid-raster')) {
      pushCanvas(map, canvas)
      map.setLayoutProperty('grid-raster', 'visibility', 'visible')
    }
  }, [grids, palette, activeLayer, projection, dark, basemapData, mapEpoch, index.q_threshold])

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

  const layerButton = (item: { id: LayerId; label: string }) => {
    const help = LAYER_HELP[item.id]
    const disabled = item.id === 'witness' && witnessMissing
    return (
      <div key={item.id} className="discovery-layer" role="none">
        <button
          type="button"
          role="radio"
          aria-checked={activeLayer === item.id}
          disabled={disabled}
          title={disabled ? 'No second dataset for this variable' : undefined}
          onClick={() => setLayerChoice(item.id)}
        >
          {item.label}
        </button>
        {help ? (
          <HelpTip label={help.label} description={disabled ? 'No second dataset for this variable' : help.text}>
            {disabled ? 'No second dataset for this variable' : help.text}
          </HelpTip>
        ) : null}
      </div>
    )
  }
  const mainLayers = layers.filter((item) => !MORE_LAYER_IDS.includes(item.id))
  const moreLayers = layers.filter((item) => MORE_LAYER_IDS.includes(item.id))
  const moreShown = moreOpen || MORE_LAYER_IDS.includes(activeLayer)

  return (
    <section className="discovery" ref={rootRef}>
      <h1 className="sr-only">Global Discovery</h1>
      <div
        className={`discovery-stage${cell ? ' has-cell' : ''}`}
        ref={stageRef}
        style={stageHeight == null ? undefined : { height: `${stageHeight}px` }}
      >
        <div className="discovery-night" ref={nightRef}>
          <div ref={mapNodeRef} className="discovery-map-canvas" aria-label="World map of the selected variable" />

          <aside className={`discovery-panel${sheetOpen ? ' is-open' : ''}`} aria-label="Map layers and legend">
            <button
              type="button"
              className="discovery-sheet-handle"
              aria-expanded={sheetOpen}
              onClick={() => setSheetOpen((open) => !open)}
            >
              <span className="discovery-sheet-grip" aria-hidden="true" />
              <span>
                {layerLabel} · {sheetOpen ? 'hide legend' : 'show legend'}
              </span>
            </button>
            <div className="discovery-panel-body">
              <div className="discovery-place-search">
                <PlaceSearch onPick={pickPlace} compact placeholder="Search a country or region" />
              </div>
              {pickedPlace ? (
                <div className="discovery-place-callout">
                  <strong>{pickedPlace.label}</strong>
                  <div className="discovery-place-actions">
                    <button
                      type="button"
                      className="discovery-primary"
                      onClick={() => navigate('region', { selection: { kind: 'region', regionId: pickedPlace.id } })}
                    >
                      Open evidence
                    </button>
                    <button type="button" onClick={() => setPickedPlace(null)} aria-label="Close place callout">
                      Close
                    </button>
                  </div>
                </div>
              ) : null}
              <h2 className="discovery-panel-title label-caps">Layer</h2>
              <p className="discovery-muted">
                {variable.label}, {windowMeta ? `${windowMeta.start} to ${windowMeta.end}` : windowId}
              </p>
              <div className="discovery-layers" role="radiogroup" aria-label="Map layer">
                {mainLayers.map(layerButton)}
                {moreLayers.length > 0 ? (
                  <>
                    <button
                      type="button"
                      className="discovery-more"
                      aria-expanded={moreShown}
                      onClick={() => setMoreOpen((open) => !open)}
                    >
                      {moreShown ? 'Fewer layers' : 'More layers'}
                    </button>
                    {moreShown ? moreLayers.map(layerButton) : null}
                  </>
                ) : null}
              </div>
              <Legend
                layer={activeLayer}
                palette={palette ?? FALLBACK_PALETTE}
                variableUnit={displayUnit}
                increaseMeans={variable.increase_means}
                qThreshold={index.q_threshold}
                rateLimit={rateLimit}
                temperatureLabel={temperatureLabel}
                moistureLabel={moistureLabel}
                verdictHasQuality={grids?.quality != null}
                verdictHasWitness={grids?.witness != null}
              />
              <p className="discovery-muted discovery-hint">Click a cell to open its case file.</p>
            </div>
          </aside>

          <div className="discovery-map-toolbar">
            <div className="discovery-segmented" role="group" aria-label="Map projection">
              <button type="button" aria-pressed={projection === 'globe'} onClick={() => setProjection('globe')}>
                Globe
              </button>
              <button type="button" aria-pressed={projection === 'mercator'} onClick={() => setProjection('mercator')}>
                Flat map
              </button>
            </div>
          </div>

          {hover ? (
            <div className="discovery-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="status">
              <strong>{hover.title}</strong>
              <span>{hover.detail}</span>
            </div>
          ) : null}

          {loadState === 'loading' && !grids ? (
            <div className="discovery-status" role="status">
              <div className="discovery-spinner" />
              <span>Loading layer…</span>
            </div>
          ) : null}
          {loadState === 'loading' && grids ? (
            <div className="discovery-status-badge" role="status">
              Updating layer…
            </div>
          ) : null}
          {basemapState === 'loading' ? (
            <div className="discovery-status" role="status">
              <div className="discovery-spinner" />
              <span>Loading Natural Earth basemap…</span>
            </div>
          ) : null}
          {basemapState === 'error' ? (
            <div className="discovery-status discovery-status-error" role="alert">
              <strong>The offline basemap failed to load.</strong>
              <span>{basemapError}</span>
            </div>
          ) : null}
          {loadState === 'error' ? (
            <div className="discovery-status discovery-status-error" role="alert">
              <strong>This layer failed to load.</strong>
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        {cell ? (
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
            witnessLabel={index.witness?.products[variableId]?.label ?? variable.product}
            onClose={() => setCell(null)}
            onInspect={() => navigate('region', { selection: { kind: 'cell', row: cell.row, col: cell.col } })}
          />
        ) : null}
      </div>

      <div className="discovery-below">
        <section className="discovery-card">
          <h2>Regions</h2>
          <label className="discovery-check">
            <input type="checkbox" checked={showRegions} onChange={(event) => setShowRegions(event.target.checked)} />
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
          basemapState={basemapState}
          temperatureLabel={temperatureLabel}
          moistureLabel={moistureLabel}
          patternLayer={activeLayer === 'pattern'}
        />
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
  verdictHasQuality,
  verdictHasWitness,
}: {
  layer: LayerId
  verdictHasQuality: boolean
  verdictHasWitness: boolean
  palette: Palette
  variableUnit: string
  increaseMeans: string
  qThreshold: number
  rateLimit: number | null
  temperatureLabel: string
  moistureLabel: string
}) {
  return (
    <section className="discovery-legend" aria-label="Legend">
      <h3>Legend</h3>
      <p>
        Display unit: {variableUnit}.
        {layer === 'verdict' ? ' Each land cell gets one of four verdicts, from layers already on the map.' : null}
        {layer === 'rate' ? ` Sen slope: ${variableUnit} per decade.` : null}
        {layer === 'std' ? ' Standardized change: standard deviations per decade.' : null}
        {layer === 'significance' ? ' Significance is an FDR-adjusted q value from 0 to 1.' : null}
        {layer === 'coverage' ? ' Coverage is a fraction of valid months from 0 to 1.' : null}
        {layer === 'trend' ? ' Trend classes describe direction, not a rate.' : null}
        {layer === 'pattern' ? ` Pattern classes compare ${temperatureLabel} and ${moistureLabel}.` : null}
        {layer === 'quality' ? ' Hatching marks a sudden shift. A code-1 shift could be a real climate jump or a data artefact; a code-2 shift falls during a documented GLDAS input change (2008–2012).' : null}
        {layer === 'witness' ? ' A second, independent NASA dataset checks the sign and significance of each trend.' : null}
      </p>
      {layer === 'verdict' ? (
        <>
          <ul>
            <li>
              <span
                className="discovery-swatch"
                style={{
                  background: `linear-gradient(90deg, ${cssRgba(palette.increase)} 50%, ${cssRgba(palette.decrease)} 50%)`,
                }}
              />
              <span>
                {VERDICT_WORDS.clean} (warm = increase, cool = decrease)
              </span>
            </li>
            <li>
              <span className="discovery-swatch" style={{ background: cssRgba(VERDICT_MARKER) }} />
              <span>{VERDICT_WORDS.flagged}</span>
            </li>
            <li>
              <span
                className="discovery-swatch"
                style={{
                  background: `repeating-linear-gradient(45deg, ${cssRgba(palette.increase)} 0 3px, ${cssRgba(VERDICT_STRIPE)} 3px 6px)`,
                }}
              />
              <span>{VERDICT_WORDS.contradicted}</span>
            </li>
            <li>
              <span
                className="discovery-swatch"
                style={{
                  background: `repeating-linear-gradient(45deg, ${cssRgba([palette.neutral[0], palette.neutral[1], palette.neutral[2], 160])} 0 1px, transparent 1px 4px)`,
                }}
              />
              <span>{VERDICT_WORDS.notYet}</span>
            </li>
            <Swatch hatch={palette} text="Not enough data" />
            <Swatch text="Outside domain (transparent)" />
          </ul>
          {!verdictHasQuality || !verdictHasWitness ? (
            <p className="discovery-muted">
              {!verdictHasQuality && !verdictHasWitness
                ? 'This variable has no sudden-shift check and no second dataset, so no cell is flagged or contradicted.'
                : !verdictHasQuality
                  ? 'This variable has no sudden-shift check, so no cell is flagged.'
                  : 'This variable has no second dataset, so no cell can be contradicted.'}
            </p>
          ) : null}
        </>
      ) : null}
      {layer === 'trend' ? (
        <ul>
          <Swatch colour={palette.increase} text={`Significant increase (${increaseMeans})`} />
          <Swatch colour={palette.decrease} text="Significant decrease" />
          <Swatch colour={[palette.neutral[0], palette.neutral[1], palette.neutral[2], 120]} text="Not significant" />
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
          <Swatch colour={[palette.mixed[0], palette.mixed[1], palette.mixed[2], 130]} text={patternWords(PATTERN_MIXED, temperatureLabel, moistureLabel)} />
          <Swatch hatch={palette} text={patternWords(INSUFFICIENT_DATA, temperatureLabel, moistureLabel)} />
          <Swatch text="Outside domain (transparent)" />
        </ul>
      ) : null}
      {layer === 'quality' ? (
        <ul>
          <QualitySwatch text="Sudden shift: could be a real climate jump or a data artefact" />
          <li>
            <span className="discovery-swatch discovery-quality-swatch discovery-quality-swatch-known" />
            <span>Sudden shift during a documented GLDAS input change (2008–2012): possible data discontinuity</span>
          </li>
          <li>
            <span className="discovery-swatch" />
            <span>No sudden shift detected</span>
          </li>
        </ul>
      ) : null}
      {layer === 'witness' ? (
        <ul>
          <Swatch colour={witnessColour(WITNESS_CORROBORATED)} text={witnessWords(WITNESS_CORROBORATED)} />
          <Swatch colour={witnessColour(WITNESS_SAME_SIGN)} text={witnessWords(WITNESS_SAME_SIGN)} />
          <Swatch colour={witnessColour(WITNESS_OPPOSITE_SIGN)} text={witnessWords(WITNESS_OPPOSITE_SIGN)} />
          <Swatch colour={witnessColour(WITNESS_CONTRADICTED)} text={witnessWords(WITNESS_CONTRADICTED)} />
          <Swatch colour={witnessColour(WITNESS_MAIN_NOT_SIGNIFICANT)} text={witnessWords(WITNESS_MAIN_NOT_SIGNIFICANT)} />
          <Swatch hatch={palette} text={witnessWords(INSUFFICIENT_DATA)} />
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

function QualitySwatch({ text }: { text: string }) {
  return (
    <li>
      <span className="discovery-swatch discovery-quality-swatch" />
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
  witnessLabel,
  onClose,
  onInspect,
}: {
  cell: CellPick
  grids: GridBundle | null
  loadState: LoadState
  variable: DataIndex['variables'][number]
  months: string[]
  windowMeta: DataIndex['windows'][number] | undefined
  qThreshold: number
  temperatureLabel: string
  moistureLabel: string
  witnessLabel: string
  onClose: () => void
  onInspect: () => void
}) {
  const values = grids ? readCell(grids, cell) : null
  const monthCount = windowMeta ? monthsInWindow(months, windowMeta.start, windowMeta.end) : null
  const unit = formatUnit(variable.display_unit)
  const verdict = values
    ? plainVerdict({
        trendClass: values.trend,
        flagged: values.quality != null && values.quality >= QUALITY_STEP,
        witnessCode: values.witness,
        increaseMeans: variable.increase_means,
        slope: values.slope,
      })
    : null
  const stampTone: 'strong' | 'caution' | 'not-yet' | 'none' = !verdict
    ? 'none'
    : verdict.tone === 'warn'
      ? 'caution'
      : verdict.tone === 'accent'
        ? 'strong'
        : verdict.label === VERDICT_LABELS.notYet
          ? 'not-yet'
          : 'none'
  const notSignificant = values ? notSignificantSentence(values, unit) : null
  const mapClass = values ? verdictClass(values.trend, values.quality, values.witness) : null
  const evaluated = values != null && values.trend !== INSUFFICIENT_DATA && values.trend !== OUTSIDE_DOMAIN
  const significant = values != null && (values.trend === TREND_INCREASE || values.trend === TREND_DECREASE)
  const exhibitTone: 'default' | 'caution' | 'increase' | 'decrease' = !values
    ? 'default'
    : stampTone === 'caution'
      ? 'caution'
      : values.trend === TREND_INCREASE
        ? 'increase'
        : values.trend === TREND_DECREASE
          ? 'decrease'
          : 'default'
  const glitch = values ? glitchAnswer(values.quality, values.breakYear) : null
  const second = values ? witnessAnswer(values.witness) : null
  return (
    <aside className="discovery-cell" aria-label="Selected cell">
      <div className="discovery-cell-head">
        <div>
          <h2 className="discovery-cell-title">
            {formatLatitude(rowToLat(cell.row))}, {formatLongitude(colToLon(cell.col))}
          </h2>
          <p className="discovery-muted">
            1° grid cell centre · row {cell.row}, column {cell.col}
          </p>
        </div>
        <button type="button" className="discovery-cell-close" onClick={onClose} aria-label="Close cell panel">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {verdict ? (
        <div className="discovery-verdict">
          <VerdictStamp label={verdict.label} tone={stampTone} />
          {notSignificant ? <p className="discovery-verdict-note">{notSignificant}</p> : null}
        </div>
      ) : (
        <p className="discovery-muted">{loadState === 'error' ? 'Unavailable' : 'Loading…'}</p>
      )}

      {values && evaluated ? (
        <Exhibit
          label="Exhibit A · Rate of change"
          value={formatStat(values.slope)}
          unit={`${unit} per decade`}
          tone={exhibitTone}
        >
          <p>
            {trendWords(values.trend, variable.increase_means)}
            {Number.isFinite(values.q) ? `. q = ${formatStat(values.q)}` : ''}
            {Number.isFinite(values.q)
              ? values.q < qThreshold
                ? ' (below the FDR threshold).'
                : ' (not below the FDR threshold).'
              : '.'}
          </p>
        </Exhibit>
      ) : null}

      {values && evaluated ? (
        <ul className="discovery-cross" aria-label="Cross-examination">
          <li>
            <span className="label-caps">1 Is it significant?</span>
            <strong>{!evaluated ? 'Not enough data' : significant ? 'Yes' : 'Not yet'}</strong>
          </li>
          <li className={glitch?.warn ? 'is-warn' : undefined}>
            <span className="label-caps">2 Could it be a data glitch?</span>
            <strong>{glitch?.text}</strong>
          </li>
          <li className={second?.warn ? 'is-warn' : undefined}>
            <span className="label-caps">3 Second dataset agree?</span>
            <strong>{second?.text}</strong>
          </li>
        </ul>
      ) : null}

      {mapClass != null ? <p className="discovery-muted">On the Verdict map: {verdictClassWords(mapClass)}.</p> : null}

      <button type="button" className="discovery-primary discovery-open" onClick={onInspect}>
        Open the evidence
      </button>

      <Disclosure summary="Full cell details">
        <dl className="discovery-facts">
          <dt>Trend class</dt>
          <dd>{values ? trendWords(values.trend, variable.increase_means) : loadState === 'error' ? 'Unavailable' : 'Loading…'}</dd>
          <dt>p</dt>
          <dd>{values ? formatStat(values.p) : '—'}</dd>
          <dt>q</dt>
          <dd>{values ? formatStat(values.q) : '—'}</dd>
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
          {values && values.quality != null ? (
            <>
              <dt>Data quality</dt>
              <dd>{qualityNote(values.quality, values.breakYear, variable.product)}</dd>
            </>
          ) : null}
          {values && values.witness != null ? (
            <>
              <dt>Second witness</dt>
              <dd>{witnessLine(values.witness, values.witnessStd, witnessLabel)}</dd>
              {combinedQualityWitness(values.quality, values.witness, witnessLabel) ? (
                <>
                  <dt>Combined reading</dt>
                  <dd>{combinedQualityWitness(values.quality, values.witness, witnessLabel)}</dd>
                </>
              ) : null}
            </>
          ) : null}
        </dl>
      </Disclosure>
    </aside>
  )
}

function glitchAnswer(quality: number | null, breakYear: number | null): { text: string; warn: boolean } {
  if (quality == null) return { text: 'Not checked for this variable', warn: false }
  if (quality >= QUALITY_STEP) {
    const year = breakYear != null && Number.isFinite(breakYear) ? ` around ${Math.round(breakYear)}` : ''
    return { text: `Possibly: sudden shift${year}`, warn: true }
  }
  if (quality === INSUFFICIENT_DATA || quality === OUTSIDE_DOMAIN) return { text: 'Not evaluated', warn: false }
  return { text: 'No sudden shift detected', warn: false }
}

function witnessAnswer(code: number | null): { text: string; warn: boolean } {
  if (code == null) return { text: 'No second dataset for this variable', warn: false }
  if (code === WITNESS_CORROBORATED) return { text: 'Yes, it agrees', warn: false }
  if (code === WITNESS_SAME_SIGN) return { text: 'On direction only', warn: false }
  if (code === WITNESS_OPPOSITE_SIGN) return { text: 'Opposite direction, not significant', warn: true }
  if (code === WITNESS_CONTRADICTED) return { text: 'No, it disagrees', warn: true }
  if (code === WITNESS_MAIN_NOT_SIGNIFICANT) return { text: 'Not tested: main trend not significant', warn: false }
  return { text: 'Not evaluated', warn: false }
}

function InfoPanel({
  variable,
  basemapState,
  temperatureLabel,
  moistureLabel,
  patternLayer,
}: {
  variable: DataIndex['variables'][number]
  basemapState: BasemapState
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
      <Disclosure summary="Technical details">
        <p>{METHOD_ONE_LINER}</p>
        <p>{COVERAGE_NOTE}</p>
        <p>
          Registry slope unit: {formatUnit(variable.slope_unit)}. The rate layer is labelled{' '}
          {formatUnit(variable.display_unit)} per decade.
        </p>
      </Disclosure>
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
        Coastlines, country borders and graticule come from Natural Earth 50m, bundled offline with the app. The globe
        uses the full 90° to −90° grid; the flat map uses Web Mercator and therefore clips beyond about ±85°.
      </p>
      <p className="discovery-muted">
        Basemap: Natural Earth (offline).{' '}
        {basemapState === 'ready'
          ? 'Land and border data loaded locally.'
          : basemapState === 'error'
            ? 'The local basemap failed to load.'
            : 'Loading the local basemap.'}
      </p>
    </section>
  )
}

function buildLayerImage(
  grids: GridBundle,
  layer: LayerId,
  palette: Palette,
  qThreshold: number,
): ImageData {
  const trendPaint = (value: number, index: number): Rgba => {
    const colour = trendColour(value, palette, index)
    if (value === INSUFFICIENT_DATA) return [colour[0], colour[1], colour[2], 220]
    return colour
  }
  const stippleTrend = (value: number) => value === TREND_NOT_SIGNIFICANT
  if (layer === 'verdict') {
    const classes = verdictGrid(grids.trend, grids.quality, grids.witness)
    const image = renderClassImage(
      classes,
      (value, index) => verdictColour(value, grids.trend[index], palette, index),
      undefined,
      { coastalFill: true, isStippled: (value) => value === VERDICT_NOT_YET },
    )
    return applyContradictedStripes(image, classes, PIXELS_PER_DEG)
  }
  if (layer === 'trend') {
    return renderClassImage(grids.trend, trendPaint, undefined, {
      coastalFill: true,
      isStippled: stippleTrend,
    })
  }
  if (layer === 'pattern') {
    return renderClassImage(
      grids.pattern,
      (value, index) => {
        const colour = patternColour(value, palette, index)
        if (value === INSUFFICIENT_DATA) return [colour[0], colour[1], colour[2], 220]
        return colour
      },
      undefined,
      { coastalFill: true, isStippled: (value) => value === PATTERN_MIXED },
    )
  }
  if (layer === 'rate') {
    const limit = finiteAbsPercentile(grids.slope, 0.98)
    return renderContinuousImage(
      grids.slope,
      (value) =>
        divergingColour(value, limit, palette.decrease, palette.increase, palette.divergingMid, 255),
      undefined,
      { opacity: significanceOpacity(grids.qValue, qThreshold), coastalFill: true },
    )
  }
  if (layer === 'std') {
    return renderContinuousImage(
      grids.stdChange,
      (value) =>
        divergingColour(value, 2, palette.decrease, palette.increase, palette.divergingMid, 255),
      undefined,
      { opacity: significanceOpacity(grids.qValue, qThreshold), coastalFill: true },
    )
  }
  if (layer === 'significance') {
    return renderContinuousImage(
      grids.qValue,
      (value) => sequentialColour(value, palette.sequentialHigh, palette.sequentialLow),
      undefined,
      { coastalFill: true },
    )
  }
  if (layer === 'coverage') {
    return renderContinuousImage(
      grids.coverage,
      (value) => sequentialColour(value, palette.sequentialLow, palette.sequentialHigh),
      undefined,
      { coastalFill: true },
    )
  }
  if (layer === 'witness') {
    return renderClassImage(
      grids.witness ?? new Int8Array(N_ROWS * N_COLS),
      (value, index) => witnessColour(value, WITNESS_PALETTE, index),
      undefined,
      {
        coastalFill: true,
        isStippled: (value) => value === WITNESS_MAIN_NOT_SIGNIFICANT,
        isValid: (value) => value !== OUTSIDE_DOMAIN,
      },
    )
  }
  return renderQualityImage(
    grids.trend,
    grids.quality ?? new Int8Array(N_ROWS * N_COLS),
    trendPaint,
    undefined,
    {
      coastalFill: true,
      isStippled: stippleTrend,
      isValid: (value) => value !== OUTSIDE_DOMAIN,
    },
  )
}

/** 1.0 for a significant cell, 0.35 otherwise; bilinearly blended by the renderer. */
function significanceOpacity(qValues: Float32Array, threshold: number): Float32Array {
  const opacity = new Float32Array(N_ROWS * N_COLS)
  for (let index = 0; index < opacity.length; index++) {
    const q = qValues[index]
    opacity[index] = Number.isFinite(q) && q < threshold ? 1 : NOT_SIGNIFICANT_OPACITY
  }
  return opacity
}

function imageCanvas(image: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not draw the grid image.')
  context.putImageData(image, 0, 0)
  return canvas
}

function imageDataFromCanvas(canvas: HTMLCanvasElement): ImageData {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not read the grid canvas.')
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

function rememberCanvas(cache: Map<string, HTMLCanvasElement>, key: string, canvas: HTMLCanvasElement): void {
  if (cache.size >= CANVAS_CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, canvas)
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
    quality: grids.quality ? grids.quality[index] : null,
    breakYear: grids.breakYear ? grids.breakYear[index] : null,
    witness: grids.witness ? grids.witness[index] : null,
    witnessStd: grids.witnessStd ? grids.witnessStd[index] : null,
  }
}

function notSignificantSentence(values: ReturnType<typeof readCell>, unit: string): string | null {
  if (values.trend !== TREND_NOT_SIGNIFICANT) return null
  if (!Number.isFinite(values.slope) || values.slope === 0) return null
  const direction = values.slope > 0 ? 'rise' : 'fall'
  const q = Number.isFinite(values.q) ? ` (q = ${formatStat(values.q)})` : ''
  return `A ${direction} of about ${formatStat(Math.abs(values.slope))} ${unit} per decade, not significant yet${q}. A longer record could change this.`
}

function witnessLine(code: number, standardizedChange: number | null, label: string): string {
  const change =
    standardizedChange != null && Number.isFinite(standardizedChange)
      ? `, standardized change ${formatStat(standardizedChange)}/decade`
      : ''
  const result =
    code === WITNESS_CORROBORATED
      ? 'agrees'
      : code === WITNESS_CONTRADICTED
        ? 'disagrees'
        : code === WITNESS_SAME_SIGN
          ? 'same direction, not significant'
          : code === WITNESS_OPPOSITE_SIGN
            ? 'opposite direction, not significant'
            : witnessWords(code).toLowerCase()
  return `Second witness (${label}): ${result}${change}`
}

function hoverDetail(
  layer: LayerId,
  grids: GridBundle,
  index: number,
  variable: DataIndex['variables'][number],
): string {
  const unit = formatUnit(variable.display_unit)
  if (layer === 'verdict') {
    const code = verdictClass(
      grids.trend[index],
      grids.quality ? grids.quality[index] : null,
      grids.witness ? grids.witness[index] : null,
    )
    return `${verdictClassWords(code)} · ${formatStat(grids.slope[index])} ${unit}/decade`
  }
  if (layer === 'trend') return `${trendWords(grids.trend[index], variable.increase_means)} · ${formatStat(grids.slope[index])} ${unit}/decade`
  if (layer === 'pattern') {
    return `${patternWords(grids.pattern[index], 'Temperature', 'Moisture')} · ${formatStat(grids.slope[index])} ${unit}/decade`
  }
  if (layer === 'quality') return `${qualityWords(grids.quality ? grids.quality[index] : null)} · ${formatStat(grids.slope[index])} ${unit}/decade`
  if (layer === 'witness') {
    const std = grids.witnessStd ? grids.witnessStd[index] : Number.NaN
    return `${witnessWords(grids.witness ? grids.witness[index] : OUTSIDE_DOMAIN)} · ${formatStat(std)}/decade`
  }
  if (layer === 'rate') return `Sen slope ${formatStat(grids.slope[index])} ${unit}/decade`
  if (layer === 'std') return `Standardized change ${formatStat(grids.stdChange[index])} per decade`
  if (layer === 'significance') return `q ${formatStat(grids.qValue[index])}`
  return `Coverage ${formatStat(grids.coverage[index])}`
}

function qualityWords(code: number | null): string {
  if (code === QUALITY_STEP) return 'Sudden shift: could be a real climate jump or a data artefact'
  if (code === QUALITY_STEP_KNOWN_FORCING) {
    return 'Sudden shift during a documented GLDAS input change (2008–2012): possible data discontinuity'
  }
  if (code === INSUFFICIENT_DATA) return 'Data quality not evaluated'
  if (code === OUTSIDE_DOMAIN) return 'Outside domain'
  return 'No sudden shift detected'
}

function documentedInputChange(product: string): string {
  const family = product.startsWith('GLDAS') ? 'GLDAS' : product
  return `documented ${family} input change (2008–2012)`
}

function qualityNote(code: number, breakYear: number | null, product: string): string {
  const year = breakYear != null && Number.isFinite(breakYear) ? Math.round(breakYear) : null
  if (code === QUALITY_STEP_KNOWN_FORCING) {
    return `Sudden shift during a ${documentedInputChange(product)}: possible data discontinuity. Read the trend with caution.`
  }
  if (code === QUALITY_STEP) {
    const around = year == null ? '' : ` around ${year}`
    return `Sudden shift${around}: this could be a real jump in the climate or a data artefact. The trend is still significant; a step fits slightly better than a straight line.`
  }
  return qualityWords(code)
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

type GridCoordinates = [[number, number], [number, number], [number, number], [number, number]]

function gridCoordinates(): GridCoordinates {
  // MapLibre image sources are placed in Mercator space even when the style
  // uses the globe projection. A corner exactly at ±90° does not tile, and a
  // near-polar corner warps the raster into radial streaks, so both modes use
  // the Web Mercator limit. The globe still shows the round planet; the last
  // ~5° at each pole is outside the image texture.
  const limit = MERCATOR_LAT_LIMIT
  return [
    [-180, limit],
    [180, limit],
    [180, -limit],
    [-180, -limit],
  ]
}

function ensureGrid(map: MapLibreMap) {
  if (map.getSource('grid')) return
  map.addSource('grid', { type: 'image', coordinates: gridCoordinates() })
  map.addLayer({
    id: 'grid-raster',
    type: 'raster',
    source: 'grid',
    layout: { visibility: 'none' },
    paint: { 'raster-resampling': 'linear', 'raster-fade-duration': 0, 'raster-opacity': 1 },
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
  imageSource.updateImage({ image: canvas, coordinates: gridCoordinates() })
  if (map.getLayer('grid-raster')) {
    map.setLayoutProperty('grid-raster', 'visibility', 'visible')
    map.setPaintProperty('grid-raster', 'raster-opacity', 1)
  }
}

