import { useEffect, useRef, type ReactNode } from 'react'
import Plotly from 'plotly.js-basic-dist-min'
import { Plot } from './plotly'
import { monthAfterIso, monthIso, useChartColors, withAlpha } from './theme'
import './charts.css'

export interface ChartTrace {
  x: readonly string[]
  y: readonly (number | null)[]
  name: string
  color: 'accent' | 'secondary' | 'text' | 'mean'
  dash?: 'solid' | 'dash'
  /** Default: a line (single valid points become markers). */
  mode?: 'line' | 'markers'
  /** Secondary axis for standardized witness series. */
  axis?: 'y' | 'y2'
}

export interface ChartMarker {
  x: string
  label: string
}

interface ChartFrameProps {
  title: string
  yTitle: string
  yTitle2?: string
  traces: readonly ChartTrace[]
  band?: { start: string; end: string } | null
  markers?: readonly ChartMarker[] | null
  footer?: ReactNode
}

export function ChartFrame({ title, yTitle, yTitle2, traces, band, markers, footer }: ChartFrameProps) {
  const colors = useChartColors()
  const frameRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame || typeof ResizeObserver === 'undefined') return
    const plots = (Plotly as { Plots?: { resize?: (node: HTMLElement) => void } }).Plots
    const observer = new ResizeObserver(() => {
      const plot = frame.querySelector('.js-plotly-plot')
      if (!(plot instanceof HTMLElement) || plot.offsetWidth === 0) return
      try {
        plots?.resize?.(plot)
      } catch {
        // Plotly throws if resize runs before the first draw.
      }
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  const palette = { accent: colors.accent, secondary: colors.secondary, text: colors.text, mean: colors.text }
  const hasY2 = traces.some((trace) => trace.axis === 'y2')
  const data: PlotSegment[] = []
  for (const trace of traces) data.push(...segmentTrace(trace, palette[trace.color], trace.axis ?? 'y'))
  const shapes: Record<string, unknown>[] = []
  if (band) {
    shapes.push({
      type: 'rect',
      xref: 'x',
      yref: 'paper',
      x0: monthIso(band.start),
      x1: monthAfterIso(band.end),
      y0: 0,
      y1: 1,
      fillcolor: withAlpha(colors.accent, 0.16),
      line: { width: 0 },
      layer: 'below',
    })
  }
  for (const marker of markers ?? []) {
    shapes.push({
      type: 'line',
      xref: 'x',
      yref: 'paper',
      x0: monthIso(marker.x),
      x1: monthIso(marker.x),
      y0: 0,
      y1: 1,
      line: { color: colors.muted, width: 1, dash: 'dot' },
    })
  }
  const annotations = (markers ?? []).map((marker) => ({
    x: monthIso(marker.x),
    y: 1,
    xref: 'x',
    yref: 'paper',
    text: marker.label,
    showarrow: false,
    font: { color: colors.muted, size: 10 },
    bgcolor: withAlpha(colors.surface, 0.88),
    bordercolor: colors.border,
    borderwidth: 1,
    xanchor: 'center',
    yanchor: 'bottom',
  }))
  const layout = {
    title: { text: title, font: { size: 14, color: colors.text }, x: 0, xanchor: 'left' },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: colors.text, family: "system-ui, 'Segoe UI', Roboto, sans-serif", size: 12 },
    autosize: true,
    dragmode: false,
    showlegend: false,
    margin: { l: 52, r: 8, t: 36, b: 36 },
    xaxis: {
      type: 'date',
      gridcolor: colors.border,
      linecolor: colors.border,
      tickfont: { color: colors.muted, size: 10 },
      zeroline: false,
    },
    yaxis: {
      title: { text: yTitle, font: { color: colors.muted, size: 11 }, standoff: 8 },
      gridcolor: colors.border,
      linecolor: colors.border,
      tickfont: { color: colors.muted, size: 10 },
      zerolinecolor: colors.muted,
    },
    ...(hasY2
      ? {
          yaxis2: {
            title: { text: yTitle2 ?? 'z-score', font: { color: colors.muted, size: 11 }, standoff: 8 },
            overlaying: 'y',
            side: 'right',
            gridcolor: 'rgba(0,0,0,0)',
            linecolor: colors.border,
            tickfont: { color: colors.muted, size: 10 },
            zerolinecolor: colors.muted,
            showgrid: false,
          },
        }
      : {}),
    hoverlabel: {
      bgcolor: colors.surface,
      bordercolor: colors.border,
      font: { color: colors.text, size: 12 },
    },
    shapes,
    annotations,
  }

  return (
    <figure className="chart-card">
      <div className="chart-frame" ref={frameRef}>
        <Plot
          data={data}
          layout={layout}
          config={{ responsive: true, displayModeBar: false, displaylogo: false }}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      {footer}
    </figure>
  )
}

interface PlotSegment {
  type: 'scatter'
  mode: 'lines' | 'markers'
  x: string[]
  y: (number | null)[]
  name: string
  connectgaps: false
  hoverinfo?: 'skip'
  hovertemplate?: string
  line?: { color: string; width: number; dash: 'solid' | 'dash' }
  marker?: { color: string; size: number }
  yaxis?: 'y' | 'y2'
}

function segmentTrace(trace: ChartTrace, color: string, axis: 'y' | 'y2'): PlotSegment[] {
  const segments: { start: number; end: number }[] = []
  let start = -1
  for (let i = 0; i < trace.y.length; i++) {
    const value = trace.y[i]
    const missing = value == null || !Number.isFinite(value)
    if (missing) {
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
      line: markerOnly ? undefined : { color, width: 1.75, dash: trace.dash ?? 'solid' },
      marker: { color, size: markerOnly ? 5 : single ? 7 : 0 },
      hovertemplate: `%{x|%Y-%m}: %{y:.4f}<extra>${trace.name}</extra>`,
      yaxis: axis === 'y2' ? 'y2' : undefined,
    }
  })
}
