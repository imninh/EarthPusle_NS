import { useEffect, useRef, useState, type ReactNode } from 'react'
import Plotly from 'plotly.js-basic-dist-min'
import { defineStrings, useLang, useStrings } from '../i18n'
import { Plot } from './plotly'
import { monthAfterIso, monthIso, useChartColors, withAlpha } from './theme'
import {
  buildPlotData,
  directLabels,
  markerAnnotations,
  markerShapes,
  type ChartMarker,
  type ChartTrace,
  type ChartTrendBand,
} from './traces'
import './charts.css'

export const STRINGS = defineStrings({ zScore: 'z-score' }, { zScore: 'điểm z' })

export type { ChartMarker, ChartTrace, ChartTrendBand }

interface ChartFrameProps {
  title: string
  yTitle: string
  yTitle2?: string
  traces: readonly ChartTrace[]
  band?: { start: string; end: string } | null
  trendBand?: ChartTrendBand | null
  markers?: readonly ChartMarker[] | null
  footer?: ReactNode
}

export function ChartFrame({
  title,
  yTitle,
  yTitle2,
  traces,
  band,
  trendBand,
  markers,
  footer,
}: ChartFrameProps) {
  const colors = useChartColors()
  const s = useStrings(STRINGS)
  const { lang } = useLang()
  const frameRef = useRef<HTMLDivElement>(null)
  // Under 760 px there is no room for a label margin; the swatch legend below the chart is used.
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 760)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 759px)')
    const apply = () => setNarrow(query.matches)
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])

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

  const hasY2 = traces.some((trace) => trace.axis === 'y2')
  const data = buildPlotData(traces, colors, trendBand, lang)
  const gridColor = withAlpha(colors.border, 0.6)
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
      fillcolor: withAlpha(colors.ink, 0.04),
      line: { width: 0 },
      layer: 'below',
    })
  }
  shapes.push(...markerShapes(markers, colors))
  const labels = narrow ? [] : directLabels(traces, colors)
  const hasLabels = labels.length > 0
  const annotations = [...markerAnnotations(markers, colors), ...labels]
  const tick = { color: colors.muted, size: 13 }
  const layout = {
    title: { text: title, font: { size: 14, color: colors.text }, x: 0, xanchor: 'left' },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: colors.text, family: "system-ui, 'Segoe UI', Roboto, sans-serif", size: 13 },
    autosize: true,
    dragmode: false,
    showlegend: false,
    barmode: 'overlay',
    margin: { l: narrow ? 48 : 58, r: hasLabels ? (hasY2 ? 176 : 132) : hasY2 && narrow ? 44 : 12, t: 40, b: 40 },
    xaxis: {
      type: 'date',
      dtick: 'M48',
      tickformat: '%Y',
      gridcolor: gridColor,
      linecolor: gridColor,
      tickfont: tick,
      zeroline: false,
    },
    yaxis: {
      title: { text: yTitle, font: tick, standoff: 8 },
      gridcolor: gridColor,
      linecolor: gridColor,
      tickfont: tick,
      zeroline: true,
      zerolinecolor: colors.ink,
      zerolinewidth: 1,
    },
    ...(hasY2
      ? {
          yaxis2: {
            title: { text: yTitle2 ?? s.zScore, font: tick, standoff: 8 },
            overlaying: 'y',
            side: 'right',
            gridcolor: 'rgba(0,0,0,0)',
            linecolor: gridColor,
            tickfont: tick,
            zeroline: false,
            showgrid: false,
          },
        }
      : {}),
    hoverlabel: {
      bgcolor: colors.surface,
      bordercolor: colors.border,
      font: { color: colors.text, size: 13, family: colors.mono },
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
