import { monthIso, withAlpha, type ChartColors } from './theme'

export interface ChartTrace {
  x: readonly string[]
  y: readonly (number | null)[]
  name: string
  color: 'accent' | 'secondary' | 'text' | 'mean' | 'ink' | 'muted'
  dash?: 'solid' | 'dash' | 'dot'
  /** Default: a line (single valid points become markers). */
  mode?: 'line' | 'markers' | 'bars'
  /** Secondary axis for standardized witness series. */
  axis?: 'y' | 'y2'
  /** Line width in px (default 2). */
  width?: number
  /** Line opacity 0..1 (default 1). */
  opacity?: number
  /** Direct label drawn at the right end of the series. */
  label?: string
}

export interface ChartMarker {
  x: string
  label: string
}

export interface ChartTrendBand {
  months: readonly string[]
  lower: readonly number[]
  upper: readonly number[]
}

export interface PlotSegment {
  type: 'scatter' | 'bar'
  mode?: 'lines' | 'markers'
  x: string[]
  y: (number | null)[]
  name: string
  connectgaps?: false
  hoverinfo?: 'skip'
  hovertemplate?: string
  line?: { color: string; width: number; dash: 'solid' | 'dash' | 'dot' }
  marker?: { color: string | string[]; size?: number }
  width?: number
  fill?: 'tonexty'
  fillcolor?: string
  yaxis?: 'y' | 'y2'
}

const BAR_WIDTH_MS = 26 * 24 * 3600 * 1000
export const BAR_OPACITY = 0.85
export const BAND_OPACITY = 0.1

export function paletteFor(colors: ChartColors): Record<ChartTrace['color'], string> {
  return {
    accent: colors.accent,
    secondary: colors.secondary,
    text: colors.ink,
    ink: colors.ink,
    mean: colors.ink,
    muted: colors.muted,
  }
}

const isValid = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value)

/** Bars: warm at or above zero, cool below; gaps stay gaps. */
export function barSegment(trace: ChartTrace, colors: ChartColors, axis: 'y' | 'y2'): PlotSegment {
  const warm = withAlpha(colors.increase, BAR_OPACITY)
  const cool = withAlpha(colors.decrease, BAR_OPACITY)
  return {
    type: 'bar',
    x: trace.x.map(monthIso),
    y: trace.y.map((value) => (isValid(value) ? value : null)),
    name: trace.name,
    width: BAR_WIDTH_MS,
    marker: { color: trace.y.map((value) => (isValid(value) && value < 0 ? cool : warm)) },
    hovertemplate: `%{x|%Y-%m}: %{y:.4f}<extra>${trace.name}</extra>`,
    yaxis: axis === 'y2' ? 'y2' : undefined,
  }
}

export function segmentTrace(
  trace: ChartTrace,
  color: string,
  axis: 'y' | 'y2',
  colors?: ChartColors,
): PlotSegment[] {
  if (trace.mode === 'bars' && colors) return [barSegment(trace, colors, axis)]
  const segments: { start: number; end: number }[] = []
  let start = -1
  for (let i = 0; i < trace.y.length; i++) {
    if (!isValid(trace.y[i])) {
      if (start >= 0) segments.push({ start, end: i - 1 })
      start = -1
    } else if (start < 0) {
      start = i
    }
  }
  if (start >= 0) segments.push({ start, end: trace.y.length - 1 })
  if (segments.length === 0) {
    return [
      {
        type: 'scatter',
        mode: 'lines',
        x: trace.x.map((month) => monthIso(month)),
        y: trace.x.map(() => null),
        name: trace.name,
        connectgaps: false,
        hoverinfo: 'skip',
        yaxis: axis === 'y2' ? 'y2' : undefined,
      },
    ]
  }
  return segments.map((segment) => {
    const single = segment.start === segment.end
    const markerOnly = trace.mode === 'markers'
    const x: string[] = []
    const y: number[] = []
    for (let i = segment.start; i <= segment.end; i++) {
      x.push(monthIso(trace.x[i]))
      y.push(trace.y[i] as number)
    }
    return {
      type: 'scatter',
      mode: markerOnly || single ? 'markers' : 'lines',
      x,
      y,
      name: trace.name,
      connectgaps: false,
      line: markerOnly ? undefined : { color: trace.opacity != null ? withAlpha(color, trace.opacity) : color, width: trace.width ?? 2, dash: trace.dash ?? 'solid' },
      marker: { color, size: markerOnly ? 5 : single ? 7 : 0 },
      hovertemplate: `%{x|%Y-%m}: %{y:.4f}<extra>${trace.name}</extra>`,
      yaxis: axis === 'y2' ? 'y2' : undefined,
    }
  })
}

/** Soft fill between the lower and upper trend interval, in the ink colour at 10%. */
export function bandSegments(band: ChartTrendBand, colors: ChartColors): PlotSegment[] {
  const transparent = withAlpha(colors.ink, 0)
  const x = band.months.map(monthIso)
  return [
    {
      type: 'scatter',
      mode: 'lines',
      x,
      y: [...band.upper],
      name: '95% interval of the trend',
      connectgaps: false,
      hoverinfo: 'skip',
      line: { color: transparent, width: 0, dash: 'solid' },
    },
    {
      type: 'scatter',
      mode: 'lines',
      x,
      y: [...band.lower],
      name: '95% interval of the trend',
      connectgaps: false,
      hoverinfo: 'skip',
      line: { color: transparent, width: 0, dash: 'solid' },
      fill: 'tonexty',
      fillcolor: withAlpha(colors.ink, BAND_OPACITY),
    },
  ]
}

/** All plot data in draw order: band first, then each trace. */
export function buildPlotData(
  traces: readonly ChartTrace[],
  colors: ChartColors,
  trendBand?: ChartTrendBand | null,
): PlotSegment[] {
  const palette = paletteFor(colors)
  const data: PlotSegment[] = []
  if (trendBand && trendBand.months.length > 0) data.push(...bandSegments(trendBand, colors))
  for (const trace of traces) data.push(...segmentTrace(trace, palette[trace.color], trace.axis ?? 'y', colors))
  return data
}

/** Vertical break-year line: 3 px marker yellow. */
export function markerShapes(markers: readonly ChartMarker[] | null | undefined, colors: ChartColors) {
  return (markers ?? []).map((marker) => ({
    type: 'line',
    xref: 'x',
    yref: 'paper',
    x0: monthIso(marker.x),
    x1: monthIso(marker.x),
    y0: 0,
    y1: 1,
    line: { color: colors.marker, width: 3 },
  }))
}

export function markerAnnotations(markers: readonly ChartMarker[] | null | undefined, colors: ChartColors) {
  return (markers ?? []).map((marker) => ({
    x: monthIso(marker.x),
    y: 1,
    xref: 'x',
    yref: 'paper',
    text: marker.label,
    showarrow: false,
    font: { color: colors.markerInk, size: 13, family: colors.mono },
    bgcolor: colors.marker,
    borderpad: 3,
    xanchor: 'center',
    yanchor: 'bottom',
  }))
}

/** Break a label into lines of at most `max` characters at spaces (Plotly annotation HTML). */
export function wrapLabel(text: string, max = 17): string {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line)
      line = word
    } else {
      line = line ? line + ' ' + word : word
    }
  }
  if (line) lines.push(line)
  return lines.join('<br>')
}

/**
 * Direct labels in the reserved right margin (paper x = 1), left-aligned just outside the plot,
 * at the height of each series' last valid point and staggered so they never collide.
 */
export function directLabels(traces: readonly ChartTrace[], colors: ChartColors) {
  const palette = paletteFor(colors)
  const out: Record<string, unknown>[] = []
  if (traces.length <= 1) return out
  const hasY2 = traces.some((trace) => trace.axis === 'y2')
  const labelled = traces.filter((trace) => trace.label)
  labelled.forEach((trace, index) => {
    let last = -1
    for (let i = trace.y.length - 1; i >= 0; i--) {
      if (isValid(trace.y[i])) {
        last = i
        break
      }
    }
    if (last < 0) return
    out.push({
      x: 1,
      y: trace.y[last],
      xref: 'paper',
      yref: trace.axis === 'y2' ? 'y2' : 'y',
      text: wrapLabel(trace.label ?? ''),
      showarrow: false,
      xanchor: 'left',
      xshift: hasY2 ? 52 : 6,
      yanchor: 'middle',
      yshift: (index - (labelled.length - 1) / 2) * 18,
      font: {
        color: trace.color === 'accent' || trace.color === 'secondary' ? palette[trace.color] : colors.muted,
        size: 13,
      },
    })
  })
  return out
}
