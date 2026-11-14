import { useEffect, useState } from 'react'
import { formatUnit } from '../lib/format'
import { ChartFrame, type ChartMarker, type ChartTrace, type ChartTrendBand } from './ChartFrame'

interface AnomalyTrendChartProps {
  months: readonly string[]
  anomalies: readonly (number | null)[]
  unit: string
  label: string
  windowStart: string
  windowEnd: string
  trendMonths: readonly string[] | null
  trendY: readonly number[] | null
  trendBand?: ChartTrendBand | null
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
  trendBand,
  annualMeans,
  breakYear,
  witnessZ,
  witnessLabel,
  witnessUnit,
  mainZ,
  caption,
}: AnomalyTrendChartProps) {
  const displayUnit = formatUnit(unit)
  const displayWitnessUnit = witnessUnit ? formatUnit(witnessUnit) : null
  const hasWitness = Boolean(witnessZ && witnessZ.length > 0 && witnessLabel)
  const [showWitness, setShowWitness] = useState(hasWitness)
  useEffect(() => {
    setShowWitness(hasWitness)
  }, [hasWitness])
  // Monthly anomalies are bars: warm above zero, cool below (colour set in traces.ts).
  const traces: ChartTrace[] = [{ x: months, y: anomalies, name: label, color: 'accent', mode: 'bars' }]
  if (showWitness && hasWitness && witnessZ) {
    if (mainZ && mainZ.length > 0) {
      traces.push({
        x: months,
        y: mainZ,
        name: `${label} (z-score)`,
        color: 'ink',
        width: 1,
        opacity: 0.45,
        axis: 'y2',
      })
    }
    traces.push({
      x: months,
      y: witnessZ,
      name: `${witnessLabel} (z-score)`,
      color: 'muted',
      dash: 'dash',
      width: 2,
      axis: 'y2',
      label: witnessLabel ?? undefined,
    })
  }
  if (trendMonths && trendY) {
    traces.push({ x: trendMonths, y: trendY, name: 'Sen trend', color: 'ink', width: 2.5, label: 'Sen trend' })
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
      : [{ x: breakYearIso(breakYear), label: `sudden shift ≈ ${Math.round(breakYear)}` }]
  return (
    <ChartFrame
      title={`Anomalies (${displayUnit})`}
      yTitle={displayUnit}
      yTitle2={showWitness && hasWitness ? 'z-score' : undefined}
      traces={traces}
      band={{ start: windowStart, end: windowEnd }}
      trendBand={trendBand ?? null}
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
              <span className="swatch swatch-increase" />
              <span className="swatch swatch-decrease" />
              {label}
            </span>
            {trendY && (
              <span className="chart-swatch">
                <span className="swatch swatch-trend" />
                Sen trend
              </span>
            )}
            {trendBand && (
              <span className="chart-swatch">
                <span className="swatch swatch-band" />
                95% interval of the trend
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
                <span className="swatch swatch-muted" />
                {witnessLabel} (z-score{displayWitnessUnit ? `, ${displayWitnessUnit}` : ''})
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
