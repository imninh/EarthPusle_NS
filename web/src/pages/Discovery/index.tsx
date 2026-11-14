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
import { formatUnitIn, glossaryEntry, plainVerdict, verdictKindOfLabel } from '../../lib/format'
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
  applyContradictedStripes,
  verdictClass,
  verdictClassWords,
  verdictColour,
  verdictGrid,
  verdictWords,
} from '../../maps/verdict'
import { type Lang, pick, useLang, useStrings, variableLabel as translateVariableLabel } from '../../i18n'
import { type LayerId, isLayerId, resolveLayer } from './layers'
import { DISCOVERY_STRINGS, increaseMeansLabel } from './strings'
import './discovery.css'

// Vite's prebundled maplibre looks for the worker beside that bundle, where the file is not
// copied. Point at the package worker before any map is created. This stays inside Discovery.
setWorkerUrl(maplibreWorkerUrl)

const VERDICT_LAYER_ID: LayerId = 'verdict'
const BASE_LAYER_IDS: readonly LayerId[] = ['trend', 'rate', 'std', 'significance', 'pattern', 'coverage']
const QUALITY_LAYER_ID: LayerId = 'quality'
const WITNESS_LAYER_ID: LayerId = 'witness'
/** Layers that stay under "More layers" until the user opens it. */
const MORE_LAYER_IDS: readonly LayerId[] = ['std', 'significance', 'pattern', 'coverage']

/**
 * One-line explanations for the layers that need a definition. Significance,
 * standardized change, data quality and second witness come from the shared
 * glossary, so the same words appear wherever the term is explained.
 */
function layerHelp(
  id: LayerId,
  s: DiscoveryText,
  lang: Lang,
): { label: string; text: string } | undefined {
  switch (id) {
    case 'verdict':
      return { label: s.layers.verdict, text: s.verdictHelp }
    // GLOSSARY entries below need a `lang` argument once lib/format is bilingual.
    case 'std':
      return { label: s.layers.std, text: glossaryEntry('standardized_change', lang).plain }
    case 'significance':
      return { label: s.layers.significance, text: glossaryEntry('q_value', lang).plain }
    case 'quality':
      return { label: s.layers.quality, text: glossaryEntry('data_quality', lang).plain }
    case 'witness':
      return { label: s.layers.witness, text: glossaryEntry('second_witness', lang).plain }
    default:
      return undefined
  }
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
  row: number
  col: number
}

type DiscoveryText = (typeof DISCOVERY_STRINGS)['en']

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
  const { lang } = useLang()
  const s = useStrings(DISCOVERY_STRINGS)
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
  const temperatureLabel = variableName(index, index.pattern_pair.temperature, lang)
  const moistureLabel = variableName(index, index.pattern_pair.moisture, lang)
  const rateLimit = useMemo(() => (grids ? finiteAbsPercentile(grids.slope, 0.98) : null), [grids])
  const qualityAvailable = Boolean(index.quality) && grids?.quality != null
  const witnessAvailable = Boolean(index.witness) && grids?.witness != null
  // A variable published without a witness product keeps its button, disabled: the
  // absence is information (P22 task 6). The layer is hidden only when the export has
  // no witness section at all.
  const witnessListed = Boolean(index.witness?.products[variableId])
  const witnessMissing = Boolean(index.witness) && !witnessListed
  const displayUnit = formatUnitIn(variable.display_unit, lang)
  const verdictAvailable = qualityAvailable || witnessAvailable
  const layerIds: readonly LayerId[] = [
    ...(verdictAvailable || grids == null ? [VERDICT_LAYER_ID] : []),
    ...BASE_LAYER_IDS,
    ...(qualityAvailable ? [QUALITY_LAYER_ID] : []),
    ...(index.witness ? [WITNESS_LAYER_ID] : []),
  ]
  const layers: ReadonlyArray<{ id: LayerId; label: string }> = layerIds.map((id) => ({
    id,
    label: s.layers[id],
  }))
  const layerLabel = layers.find((item) => item.id === activeLayer)?.label ?? activeLayer
  const displayVariableLabel = translateVariableLabel(variable, lang)

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
      // The text of the tooltip is built at render time, so a language change only re-renders text.
      setHover({ x: event.point.x, y: event.point.y, row, col })
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
    const help = layerHelp(item.id, s, lang)
    const disabled = item.id === 'witness' && witnessMissing
    return (
      <div key={item.id} className="discovery-layer" role="none">
        <button
          type="button"
          role="radio"
          aria-checked={activeLayer === item.id}
          disabled={disabled}
          title={disabled ? s.noSecondDataset : undefined}
          onClick={() => setLayerChoice(item.id)}
        >
          {item.label}
        </button>
        {help ? (
          <HelpTip label={help.label} description={disabled ? s.noSecondDataset : help.text}>
            {disabled ? s.noSecondDataset : help.text}
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
      <h1 className="sr-only">{s.h1}</h1>
      <div
        className={`discovery-stage${cell ? ' has-cell' : ''}`}
        ref={stageRef}
        style={stageHeight == null ? undefined : { height: `${stageHeight}px` }}
      >
        <div className="discovery-night" ref={nightRef}>
          <div ref={mapNodeRef} className="discovery-map-canvas" aria-label={s.mapAria} />

          <aside className={`discovery-panel${sheetOpen ? ' is-open' : ''}`} aria-label={s.panelAria}>
            <button
              type="button"
              className="discovery-sheet-handle"
              aria-expanded={sheetOpen}
              onClick={() => setSheetOpen((open) => !open)}
            >
              <span className="discovery-sheet-grip" aria-hidden="true" />
              <span>{sheetOpen ? s.handleHide(layerLabel) : s.handleShow(layerLabel)}</span>
            </button>
            <div className="discovery-panel-body">
              <div className="discovery-place-search">
                <PlaceSearch onPick={pickPlace} compact placeholder={s.searchPlaceholder} />
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
                      {s.openEvidence}
                    </button>
                    <button type="button" onClick={() => setPickedPlace(null)} aria-label={s.closeCalloutAria}>
                      {s.close}
                    </button>
                  </div>
                </div>
              ) : null}
              <h2 className="discovery-panel-title label-caps">{s.layerTitle}</h2>
              <p className="discovery-muted">
                {s.layerSubtitle(
                  displayVariableLabel,
                  windowMeta ? s.windowRange(windowMeta.start, windowMeta.end) : windowId,
                )}
              </p>
              <div className="discovery-layers" role="radiogroup" aria-label={s.layerGroupAria}>
                {mainLayers.map(layerButton)}
                {moreLayers.length > 0 ? (
                  <>
                    <button
                      type="button"
                      className="discovery-more"
                      aria-expanded={moreShown}
                      onClick={() => setMoreOpen((open) => !open)}
                    >
                      {moreShown ? s.fewerLayers : s.moreLayers}
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
              <p className="discovery-muted discovery-hint">{s.clickHint}</p>
            </div>
          </aside>

          <div className="discovery-map-toolbar">
            <div className="discovery-segmented" role="group" aria-label={s.projectionAria}>
              <button type="button" aria-pressed={projection === 'globe'} onClick={() => setProjection('globe')}>
                {s.globe}
              </button>
              <button type="button" aria-pressed={projection === 'mercator'} onClick={() => setProjection('mercator')}>
                {s.flatMap}
              </button>
            </div>
          </div>

          {hover && grids ? (
            <div className="discovery-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="status">
              <strong>{`${formatLatitude(rowToLat(hover.row), s)}, ${formatLongitude(colToLon(hover.col), s)}`}</strong>
              <span>{hoverDetail(activeLayer, grids, cellIndex(hover.row, hover.col), variable, lang)}</span>
            </div>
          ) : null}

          {loadState === 'loading' && !grids ? (
            <div className="discovery-status" role="status">
              <div className="discovery-spinner" />
              <span>{s.loadingLayer}</span>
            </div>
          ) : null}
          {loadState === 'loading' && grids ? (
            <div className="discovery-status-badge" role="status">
              {s.updatingLayer}
            </div>
          ) : null}
          {basemapState === 'loading' ? (
            <div className="discovery-status" role="status">
              <div className="discovery-spinner" />
              <span>{s.loadingBasemap}</span>
            </div>
          ) : null}
          {basemapState === 'error' ? (
            <div className="discovery-status discovery-status-error" role="alert">
              <strong>{s.basemapFailed}</strong>
              <span>{basemapError}</span>
            </div>
          ) : null}
          {loadState === 'error' ? (
            <div className="discovery-status discovery-status-error" role="alert">
              <strong>{s.layerFailed}</strong>
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
          <h2>{s.regionsTitle}</h2>
          <label className="discovery-check">
            <input type="checkbox" checked={showRegions} onChange={(event) => setShowRegions(event.target.checked)} />
            {s.showOutlines}
          </label>
          <p className="discovery-muted">{s.regionsNote}</p>
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
  const { lang } = useLang()
  const s = useStrings(DISCOVERY_STRINGS)
  const words = verdictWords(lang)
  return (
    <section className="discovery-legend" aria-label={s.legend}>
      <h3>{s.legend}</h3>
      <p>
        {s.displayUnit(variableUnit)}
        {layer === 'verdict' ? s.introVerdict : null}
        {layer === 'rate' ? s.introRate(variableUnit) : null}
        {layer === 'std' ? s.introStd : null}
        {layer === 'significance' ? s.introSignificance : null}
        {layer === 'coverage' ? s.introCoverage : null}
        {layer === 'trend' ? s.introTrend : null}
        {layer === 'pattern' ? s.introPattern(temperatureLabel, moistureLabel) : null}
        {layer === 'quality' ? s.introQuality : null}
        {layer === 'witness' ? s.introWitness : null}
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
                {words.clean}
                {s.warmCoolNote}
              </span>
            </li>
            <li>
              <span className="discovery-swatch" style={{ background: cssRgba(VERDICT_MARKER) }} />
              <span>{words.flagged}</span>
            </li>
            <li>
              <span
                className="discovery-swatch"
                style={{
                  background: `repeating-linear-gradient(45deg, ${cssRgba(palette.increase)} 0 3px, ${cssRgba(VERDICT_STRIPE)} 3px 6px)`,
                }}
              />
              <span>{words.contradicted}</span>
            </li>
            <li>
              <span
                className="discovery-swatch"
                style={{
                  background: `repeating-linear-gradient(45deg, ${cssRgba([palette.neutral[0], palette.neutral[1], palette.neutral[2], 160])} 0 1px, transparent 1px 4px)`,
                }}
              />
              <span>{words.notYet}</span>
            </li>
            <Swatch hatch={palette} text={s.notEnoughData} />
            <Swatch text={s.outsideTransparent} />
          </ul>
          {!verdictHasQuality || !verdictHasWitness ? (
            <p className="discovery-muted">
              {!verdictHasQuality && !verdictHasWitness
                ? s.verdictMissingBoth
                : !verdictHasQuality
                  ? s.verdictMissingQuality
                  : s.verdictMissingWitness}
            </p>
          ) : null}
        </>
      ) : null}
      {layer === 'trend' ? (
        <ul>
          <Swatch colour={palette.increase} text={s.significantIncrease(increaseMeansLabel(increaseMeans, lang))} />
          <Swatch colour={palette.decrease} text={s.significantDecrease} />
          <Swatch colour={[palette.neutral[0], palette.neutral[1], palette.neutral[2], 120]} text={s.notSignificant} />
          <Swatch hatch={palette} text={s.insufficientData} />
          <Swatch text={s.outsideTransparent} />
        </ul>
      ) : null}
      {layer === 'rate' && rateLimit != null ? (
        <>
          <Ramp left={palette.decrease} mid={palette.divergingMid} right={palette.increase} />
          <p className="discovery-muted">
            {s.rateNote(formatStat(rateLimit), variableUnit, String(Math.round(NOT_SIGNIFICANT_OPACITY * 100)))}
          </p>
        </>
      ) : null}
      {layer === 'std' ? (
        <>
          <Ramp left={palette.decrease} mid={palette.divergingMid} right={palette.increase} />
          <p className="discovery-muted">{s.stdNote}</p>
        </>
      ) : null}
      {layer === 'significance' ? (
        <>
          <ThresholdRamp low={palette.sequentialHigh} high={palette.sequentialLow} threshold={qThreshold} />
          <p className="discovery-muted">{s.significanceNote(String(qThreshold))}</p>
        </>
      ) : null}
      {layer === 'coverage' ? (
        <>
          <ThresholdRamp low={palette.sequentialLow} high={palette.sequentialHigh} threshold={null} />
          <p className="discovery-muted">{s.coverageNote}</p>
        </>
      ) : null}
      {layer === 'pattern' ? (
        <ul>
          <Swatch colour={palette.warmingDrying} text={patternWords(PATTERN_WARMING_DRYING, temperatureLabel, moistureLabel, s)} />
          <Swatch colour={palette.warmingWetting} text={patternWords(PATTERN_WARMING_WETTING, temperatureLabel, moistureLabel, s)} />
          <Swatch colour={palette.coolingDrying} text={patternWords(PATTERN_COOLING_DRYING, temperatureLabel, moistureLabel, s)} />
          <Swatch colour={palette.coolingWetting} text={patternWords(PATTERN_COOLING_WETTING, temperatureLabel, moistureLabel, s)} />
          <Swatch colour={[palette.mixed[0], palette.mixed[1], palette.mixed[2], 130]} text={patternWords(PATTERN_MIXED, temperatureLabel, moistureLabel, s)} />
          <Swatch hatch={palette} text={patternWords(INSUFFICIENT_DATA, temperatureLabel, moistureLabel, s)} />
          <Swatch text={s.outsideTransparent} />
        </ul>
      ) : null}
      {layer === 'quality' ? (
        <ul>
          <QualitySwatch text={s.qualityShift} />
          <li>
            <span className="discovery-swatch discovery-quality-swatch discovery-quality-swatch-known" />
            <span>{s.qualityKnown}</span>
          </li>
          <li>
            <span className="discovery-swatch" />
            <span>{s.qualityNone}</span>
          </li>
        </ul>
      ) : null}
      {layer === 'witness' ? (
        <ul>
          <Swatch colour={witnessColour(WITNESS_CORROBORATED)} text={witnessWords(WITNESS_CORROBORATED, lang)} />
          <Swatch colour={witnessColour(WITNESS_SAME_SIGN)} text={witnessWords(WITNESS_SAME_SIGN, lang)} />
          <Swatch colour={witnessColour(WITNESS_OPPOSITE_SIGN)} text={witnessWords(WITNESS_OPPOSITE_SIGN, lang)} />
          <Swatch colour={witnessColour(WITNESS_CONTRADICTED)} text={witnessWords(WITNESS_CONTRADICTED, lang)} />
          <Swatch colour={witnessColour(WITNESS_MAIN_NOT_SIGNIFICANT)} text={witnessWords(WITNESS_MAIN_NOT_SIGNIFICANT, lang)} />
          <Swatch hatch={palette} text={witnessWords(INSUFFICIENT_DATA, lang)} />
          <Swatch text={s.outsideTransparent} />
        </ul>
      ) : null}
      <p>{s.footerThreshold}</p>
      <p>{s.footerNotSignificant}</p>
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
  const { lang } = useLang()
  const s = useStrings(DISCOVERY_STRINGS)
  const values = grids ? readCell(grids, cell) : null
  const monthCount = windowMeta ? monthsInWindow(months, windowMeta.start, windowMeta.end) : null
  // lib/format needs a `lang` argument here once it is bilingual: formatUnit, plainVerdict, VERDICT_LABELS.
  const unit = formatUnitIn(variable.display_unit, lang)
  const increaseMeans = increaseMeansLabel(variable.increase_means, lang)
  const verdict = values
    ? plainVerdict({
        trendClass: values.trend,
        flagged: values.quality != null && values.quality >= QUALITY_STEP,
        witnessCode: values.witness,
        increaseMeans: variable.increase_means,
        slope: values.slope,
      }, lang)
    : null
  const stampTone: 'strong' | 'caution' | 'not-yet' | 'none' = !verdict
    ? 'none'
    : verdict.tone === 'warn'
      ? 'caution'
      : verdict.tone === 'accent'
        ? 'strong'
        : verdictKindOfLabel(verdict.label) === 'notYet'
          ? 'not-yet'
          : 'none'
  const notSignificant = values ? notSignificantSentence(values, unit, s) : null
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
  const glitch = values ? glitchAnswer(values.quality, values.breakYear, s) : null
  const second = values ? witnessAnswer(values.witness, s) : null
  return (
    <aside className="discovery-cell" aria-label={s.cellAria}>
      <div className="discovery-cell-head">
        <div>
          <h2 className="discovery-cell-title">
            {formatLatitude(rowToLat(cell.row), s)}, {formatLongitude(colToLon(cell.col), s)}
          </h2>
          <p className="discovery-muted">{s.cellCentre(String(cell.row), String(cell.col))}</p>
        </div>
        <button type="button" className="discovery-cell-close" onClick={onClose} aria-label={s.closeCellAria}>
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
        <p className="discovery-muted">{loadState === 'error' ? s.unavailable : s.loading}</p>
      )}

      {values && evaluated ? (
        <Exhibit
          label={s.exhibitA}
          value={formatStat(values.slope)}
          unit={s.perDecadeUnit(unit)}
          tone={exhibitTone}
        >
          <p>
            {trendWords(values.trend, increaseMeans, s)}
            {Number.isFinite(values.q) ? `. q = ${formatStat(values.q)}` : ''}
            {Number.isFinite(values.q) ? (values.q < qThreshold ? s.belowThreshold : s.notBelowThreshold) : '.'}
          </p>
        </Exhibit>
      ) : null}

      {values && evaluated ? (
        <ul className="discovery-cross" aria-label={s.crossAria}>
          <li>
            <span className="label-caps">{s.crossQ1}</span>
            <strong>{!evaluated ? s.notEnoughData : significant ? s.yes : s.notYet}</strong>
          </li>
          <li className={glitch?.warn ? 'is-warn' : undefined}>
            <span className="label-caps">{s.crossQ2}</span>
            <strong>{glitch?.text}</strong>
          </li>
          <li className={second?.warn ? 'is-warn' : undefined}>
            <span className="label-caps">{s.crossQ3}</span>
            <strong>{second?.text}</strong>
          </li>
        </ul>
      ) : null}

      {mapClass != null ? <p className="discovery-muted">{s.onVerdictMap(verdictClassWords(mapClass, lang))}</p> : null}

      <button type="button" className="discovery-primary discovery-open" onClick={onInspect}>
        {s.openTheEvidence}
      </button>

      <Disclosure summary={s.fullDetails}>
        <dl className="discovery-facts">
          <dt>{s.dtTrendClass}</dt>
          <dd>{values ? trendWords(values.trend, increaseMeans, s) : loadState === 'error' ? s.unavailable : s.loading}</dd>
          <dt>p</dt>
          <dd>{values ? formatStat(values.p) : '—'}</dd>
          <dt>q</dt>
          <dd>{values ? formatStat(values.q) : '—'}</dd>
          <dt>τ</dt>
          <dd>{values ? formatStat(values.tau) : '—'}</dd>
          <dt>{s.dtValidMonths}</dt>
          <dd>
            {values ? formatCount(values.nValid) : '—'}
            {monthCount != null ? s.ofMonths(String(monthCount)) : ''}
          </dd>
          <dt>{s.dtCoverage}</dt>
          <dd>{values ? formatStat(values.coverage) : '—'}</dd>
          <dt>{s.dtProduct}</dt>
          <dd>{variable.product}</dd>
          <dt>{s.dtSourceVariable}</dt>
          <dd>{variable.source_variable}</dd>
          {values ? (
            <>
              <dt>{s.dtPatternClass}</dt>
              <dd>{patternWords(values.pattern, temperatureLabel, moistureLabel, s)}</dd>
            </>
          ) : null}
          {values && values.quality != null ? (
            <>
              <dt>{s.dtDataQuality}</dt>
              <dd>{qualityNote(values.quality, values.breakYear, variable.product, s)}</dd>
            </>
          ) : null}
          {values && values.witness != null ? (
            <>
              <dt>{s.dtSecondWitness}</dt>
              <dd>{witnessLine(values.witness, values.witnessStd, witnessLabel, s, lang)}</dd>
              {combinedQualityWitness(values.quality, values.witness, witnessLabel, lang) ? (
                <>
                  <dt>{s.dtCombined}</dt>
                  <dd>{combinedQualityWitness(values.quality, values.witness, witnessLabel, lang)}</dd>
                </>
              ) : null}
            </>
          ) : null}
        </dl>
      </Disclosure>
    </aside>
  )
}

function glitchAnswer(
  quality: number | null,
  breakYear: number | null,
  s: DiscoveryText,
): { text: string; warn: boolean } {
  if (quality == null) return { text: s.glitchNotChecked, warn: false }
  if (quality >= QUALITY_STEP) {
    const year = breakYear != null && Number.isFinite(breakYear) ? s.aroundYear(String(Math.round(breakYear))) : ''
    return { text: s.glitchPossibly(year), warn: true }
  }
  if (quality === INSUFFICIENT_DATA || quality === OUTSIDE_DOMAIN) return { text: s.notEvaluated, warn: false }
  return { text: s.qualityNone, warn: false }
}

function witnessAnswer(code: number | null, s: DiscoveryText): { text: string; warn: boolean } {
  if (code == null) return { text: s.answerNoSecond, warn: false }
  if (code === WITNESS_CORROBORATED) return { text: s.answerYesAgrees, warn: false }
  if (code === WITNESS_SAME_SIGN) return { text: s.answerDirectionOnly, warn: false }
  if (code === WITNESS_OPPOSITE_SIGN) return { text: s.answerOppositeNotSignificant, warn: true }
  if (code === WITNESS_CONTRADICTED) return { text: s.answerNoDisagrees, warn: true }
  if (code === WITNESS_MAIN_NOT_SIGNIFICANT) return { text: s.answerNotTested, warn: false }
  return { text: s.notEvaluated, warn: false }
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
  const s = useStrings(DISCOVERY_STRINGS)
  const { lang } = useLang()
  return (
    <section className="discovery-card">
      <h2>{s.datasetTitle}</h2>
      <dl className="discovery-facts">
        <dt>{s.dtDataset}</dt>
        <dd>{variable.product}</dd>
        <dt>{s.dtProductVersion}</dt>
        <dd>{variable.product_version}</dd>
        <dt>{s.dtDoi}</dt>
        <dd>
          {variable.doi ? (
            <a href={doiHref(variable.doi)} target="_blank" rel="noreferrer">
              {variable.doi}
            </a>
          ) : (
            s.noneListed
          )}
        </dd>
      </dl>
      <Disclosure summary={s.technicalDetails}>
        <p>{s.methodOneLiner}</p>
        <p>{s.coverageRule}</p>
        <p>{s.registryUnit(formatUnitIn(variable.slope_unit, lang), formatUnitIn(variable.display_unit, lang))}</p>
      </Disclosure>
      <h3>{s.caveats}</h3>
      {variable.caveats.length > 0 ? (
        <ul>
          {variable.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      ) : (
        <p>{s.noCaveats}</p>
      )}
      {patternLayer ? <p>{s.patternLayerNote(temperatureLabel, moistureLabel)}</p> : null}
      <p>{s.basemapSources}</p>
      <p className="discovery-muted">
        {s.basemapLabel}{' '}
        {basemapState === 'ready'
          ? s.basemapReady
          : basemapState === 'error'
            ? s.basemapError
            : s.basemapLoading}
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

function notSignificantSentence(values: ReturnType<typeof readCell>, unit: string, s: DiscoveryText): string | null {
  if (values.trend !== TREND_NOT_SIGNIFICANT) return null
  if (!Number.isFinite(values.slope) || values.slope === 0) return null
  const direction = values.slope > 0 ? s.rise : s.fall
  const q = Number.isFinite(values.q) ? s.qSuffix(formatStat(values.q)) : ''
  return s.notSignificantSentence(direction, formatStat(Math.abs(values.slope)), unit, q)
}

function witnessLine(
  code: number,
  standardizedChange: number | null,
  label: string,
  s: DiscoveryText,
  lang: Lang,
): string {
  const change =
    standardizedChange != null && Number.isFinite(standardizedChange)
      ? s.witnessChange(formatStat(standardizedChange))
      : ''
  const result =
    code === WITNESS_CORROBORATED
      ? s.witnessAgrees
      : code === WITNESS_CONTRADICTED
        ? s.witnessDisagrees
        : code === WITNESS_SAME_SIGN
          ? s.witnessSameSign
          : code === WITNESS_OPPOSITE_SIGN
            ? s.witnessOppositeSign
            : witnessWords(code, lang).toLowerCase()
  return s.witnessLine(label, result, change)
}

function hoverDetail(
  layer: LayerId,
  grids: GridBundle,
  index: number,
  variable: DataIndex['variables'][number],
  lang: Lang,
): string {
  const s = pick(DISCOVERY_STRINGS, lang)
  // formatUnit needs a `lang` argument here once lib/format is bilingual.
  const unit = formatUnitIn(variable.display_unit, lang)
  const increaseMeans = increaseMeansLabel(variable.increase_means, lang)
  const withSlope = (words: string) => `${words} · ${formatStat(grids.slope[index])} ${unit}${s.perDecadeShort}`
  if (layer === 'verdict') {
    const code = verdictClass(
      grids.trend[index],
      grids.quality ? grids.quality[index] : null,
      grids.witness ? grids.witness[index] : null,
    )
    return withSlope(verdictClassWords(code, lang))
  }
  if (layer === 'trend') return withSlope(trendWords(grids.trend[index], increaseMeans, s))
  if (layer === 'pattern') {
    return withSlope(patternWords(grids.pattern[index], s.temperatureWord, s.moistureWord, s))
  }
  if (layer === 'quality') return withSlope(qualityWords(grids.quality ? grids.quality[index] : null, s))
  if (layer === 'witness') {
    const std = grids.witnessStd ? grids.witnessStd[index] : Number.NaN
    return `${witnessWords(grids.witness ? grids.witness[index] : OUTSIDE_DOMAIN, lang)} · ${formatStat(std)}${s.perDecadeShort}`
  }
  if (layer === 'rate') return s.hoverRate(formatStat(grids.slope[index]), unit)
  if (layer === 'std') return s.hoverStd(formatStat(grids.stdChange[index]))
  if (layer === 'significance') return s.hoverQ(formatStat(grids.qValue[index]))
  return s.hoverCoverage(formatStat(grids.coverage[index]))
}

function qualityWords(code: number | null, s: DiscoveryText): string {
  if (code === QUALITY_STEP) return s.qualityShift
  if (code === QUALITY_STEP_KNOWN_FORCING) return s.qualityKnown
  if (code === INSUFFICIENT_DATA) return s.qualityNotEvaluated
  if (code === OUTSIDE_DOMAIN) return s.outsideDomain
  return s.qualityNone
}

function qualityNote(code: number, breakYear: number | null, product: string, s: DiscoveryText): string {
  const year = breakYear != null && Number.isFinite(breakYear) ? Math.round(breakYear) : null
  if (code === QUALITY_STEP_KNOWN_FORCING) {
    const family = product.startsWith('GLDAS') ? 'GLDAS' : product
    return s.qualityKnownNote(family)
  }
  if (code === QUALITY_STEP) {
    const around = year == null ? '' : s.aroundYear(String(year))
    return s.qualityStepNote(around)
  }
  return qualityWords(code, s)
}

function trendWords(code: number, increaseMeans: string, s: DiscoveryText): string {
  if (code === TREND_INCREASE) return s.significantIncrease(increaseMeans)
  if (code === TREND_DECREASE) return s.significantDecrease
  if (code === TREND_NOT_SIGNIFICANT) return s.notSignificant
  if (code === INSUFFICIENT_DATA) return s.insufficientData
  if (code === OUTSIDE_DOMAIN) return s.outsideDomain
  return s.trendUnknown(String(code))
}

function patternWords(code: number, temperature: string, moisture: string, s: DiscoveryText): string {
  if (code === PATTERN_WARMING_DRYING) return s.patternIncDec(temperature, moisture)
  if (code === PATTERN_WARMING_WETTING) return s.patternIncInc(temperature, moisture)
  if (code === PATTERN_COOLING_DRYING) return s.patternDecDec(temperature, moisture)
  if (code === PATTERN_COOLING_WETTING) return s.patternDecInc(temperature, moisture)
  if (code === PATTERN_MIXED) return s.patternMixed
  if (code === INSUFFICIENT_DATA) return s.insufficientData
  if (code === OUTSIDE_DOMAIN) return s.outsideDomain
  return s.patternUnknown(String(code))
}

function variableName(index: DataIndex, id: string, lang: Lang): string {
  const found = index.variables.find((item) => item.id === id)
  return found ? translateVariableLabel(found, lang) : id
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

function formatLatitude(value: number, s: DiscoveryText): string {
  const hemisphere = value > 0 ? s.hemiNorth : value < 0 ? s.hemiSouth : ''
  return `${Math.abs(value).toFixed(1)}°${hemisphere}`
}

function formatLongitude(value: number, s: DiscoveryText): string {
  const hemisphere = value > 0 ? s.hemiEast : value < 0 ? s.hemiWest : ''
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

