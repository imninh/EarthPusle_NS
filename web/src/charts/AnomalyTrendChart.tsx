import { useEffect, useState } from 'react'
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
  witnessZ?: readonly (number | null)[] | null
  witnessLabel?: string | null
  witnessUnit?: string | null
  mainZ?: readonly (number | null)[] | null
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
  witnessZ,
  witnessLabel,
  witnessUnit,
  mainZ,
  caption,
}: AnomalyTrendChartProps) {
  const hasWitness = Boolean(witnessZ && witnessZ.length > 0 && witnessLabel)
  const [showWitness, setShowWitness] = useState(hasWitness)
  useEffect(() => {
    setShowWitness(hasWitness)
  }, [hasWitness])
  const traces: ChartTrace[] = [{ x: months, y: anomalies, name: label, color: 'accent' }]
  if (showWitness && hasWitness && witnessZ) {
    if (mainZ && mainZ.length > 0) {
      traces.push({
        x: months,
        y: mainZ,
        name: `${label} (z-score)`,
        color: 'accent',
        dash: 'dash',
        axis: 'y2',
      })
    }
    traces.push({
      x: months,
      y: witnessZ,
      name: `${witnessLabel} (z-score)`,
      color: 'secondary',
      axis: 'y2',
    })
  }
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
      yTitle2={showWitness && hasWitness ? 'z-score' : undefined}
      traces={traces}
      band={{ start: windowStart, end: windowEnd }}
      markers={markers}
      footer={
        <>
          {hasWitness ? (
            <label className="chart-toggle">
              <input
                type="checkbox"
                checked={showWitness}
                onChange={(event) => setShowWitness(event.target.checked)}
              />
              Show second witness
            </label>
          ) : null}
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
            {showWitness && hasWitness ? (
              <span className="chart-swatch">
                <span className="swatch swatch-secondary" />
                {witnessLabel} (z-score{witnessUnit ? `, ${witnessUnit}` : ''})
              </span>
            ) : null}
          </div>
          <p className="chart-note">{caption}</p>
          {showWitness && hasWitness ? (
            <p className="chart-note">
              Both series are standardized inside the same window on the right axis; the left axis keeps the main
              anomaly units. Compare direction and shape, not raw height.
            </p>
          ) : null}
        </>
      }
    />
  )
}
