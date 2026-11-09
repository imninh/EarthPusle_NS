import { ChartFrame, type ChartTrace } from './ChartFrame'

interface AnomalyTrendChartProps {
  months: readonly string[]
  anomalies: readonly (number | null)[]
  unit: string
  label: string
  windowStart: string
  windowEnd: string
  trendMonths: readonly string[] | null
  trendY: readonly number[] | null
  caption: string
}

export function AnomalyTrendChart({
  months,
  anomalies,
  unit,
  label,
  windowStart,
  windowEnd,
  trendMonths,
  trendY,
  caption,
}: AnomalyTrendChartProps) {
  const traces: ChartTrace[] = [{ x: months, y: anomalies, name: label, color: 'accent' }]
  if (trendMonths && trendY) {
    traces.push({ x: trendMonths, y: trendY, name: 'Sen trend', color: 'text', dash: 'dash' })
  }
  return (
    <ChartFrame
      title={`Anomalies (${unit})`}
      yTitle={unit}
      traces={traces}
      band={{ start: windowStart, end: windowEnd }}
      footer={
        <>
          <div className="chart-swatches">
            <span className="chart-swatch">
              <span className="swatch swatch-accent" />
              {label}
            </span>
            {trendY && (
              <span className="chart-swatch">
                <span className="swatch swatch-trend" />
                Sen trend
              </span>
            )}
          </div>
          <p className="chart-note">{caption}</p>
        </>
      }
    />
  )
}
