import { ChartFrame, type ChartMarker, type ChartTrace } from './ChartFrame'

interface AnomalyTrendChartProps {
  months: readonly string[]
  anomalies: readonly (number | null)[]
  unit: string
  label: string
  windowStart: string
  windowEnd: string
  trendMonths: readonly string[] | null
  trendY: readonly number[] | null
  annualMeans?: { x: readonly string[]; y: readonly number[] } | null
  breakYear?: number | null
  caption: string
}

/** Decimal year → first day of the nearest month, used for the break marker. */
function breakYearIso(year: number): string {
  const whole = Math.floor(year)
  const fraction = year - whole
  const effective = fraction < 0.01 ? 0.5 : fraction
  const month = Math.min(12, Math.max(1, Math.round(effective * 11) + 1))
  return `${whole}-${String(month).padStart(2, '0')}-01`
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
  annualMeans,
  breakYear,
  caption,
}: AnomalyTrendChartProps) {
  const traces: ChartTrace[] = [{ x: months, y: anomalies, name: label, color: 'accent' }]
  if (trendMonths && trendY) {
    traces.push({ x: trendMonths, y: trendY, name: 'Sen trend', color: 'text', dash: 'dash' })
  }
  const hasAnnualMeans = Boolean(annualMeans && annualMeans.x.length > 0)
  if (annualMeans && hasAnnualMeans) {
    traces.push({
      x: annualMeans.x,
      y: annualMeans.y,
      name: 'Annual mean',
      color: 'mean',
      mode: 'markers',
    })
  }
  const markers: ChartMarker[] =
    breakYear == null || !Number.isFinite(breakYear)
      ? []
      : [{ x: breakYearIso(breakYear), label: `Possible break ~${Math.round(breakYear)}` }]
  return (
    <ChartFrame
      title={`Anomalies (${unit})`}
      yTitle={unit}
      traces={traces}
      band={{ start: windowStart, end: windowEnd }}
      markers={markers}
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
            {hasAnnualMeans && (
              <span className="chart-swatch">
                <span className="swatch swatch-mean" />
                Annual mean
              </span>
            )}
          </div>
          <p className="chart-note">{caption}</p>
        </>
      }
    />
  )
}
