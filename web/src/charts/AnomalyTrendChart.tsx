import { useEffect, useState } from 'react'
import { formatUnit } from '../lib/format'
import { defineStrings, useStrings } from '../i18n'
import { ChartFrame, type ChartMarker, type ChartTrace, type ChartTrendBand } from './ChartFrame'

export const STRINGS = defineStrings(
  {
    title: (unit: string) => `Anomalies (${unit})`,
    zScore: 'z-score',
    senTrend: 'Sen trend',
    annualMean: 'Annual mean',
    band: '95% interval of the trend',
    shift: (year: number) => `sudden shift ≈ ${year}`,
    showWitness: 'Show second witness',
    witnessLegend: (label: string, unit: string | null) => `${label} (z-score${unit ? `, ${unit}` : ''})`,
    witnessSeries: (label: string) => `${label} (z-score)`,
    witnessNote:
      'Both series are standardized inside the same window on the right axis; the left axis keeps the main anomaly units. Compare direction and shape, not raw height.',
  },
  {
    title: (unit: string) => `Độ lệch so với mức trung bình (${unit})`,
    zScore: 'điểm z',
    senTrend: 'Xu hướng Sen',
    annualMean: 'Trung bình năm',
    band: 'Khoảng tin cậy 95% của xu hướng',
    shift: (year: number) => `bước nhảy đột ngột ≈ ${year}`,
    showWitness: 'Hiện bộ dữ liệu NASA thứ hai',
    witnessLegend: (label: string, unit: string | null) => `${label} (điểm z${unit ? `, ${unit}` : ''})`,
    witnessSeries: (label: string) => `${label} (điểm z)`,
    witnessNote:
      'Cả hai chuỗi được chuẩn hóa trong cùng một giai đoạn và vẽ theo trục bên phải; trục bên trái giữ đơn vị gốc của độ lệch. Hãy so sánh hướng và hình dạng, đừng so sánh độ cao tuyệt đối.',
  },
)

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
  const s = useStrings(STRINGS)
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
        name: s.witnessSeries(label),
        color: 'ink',
        width: 1,
        opacity: 0.45,
        axis: 'y2',
      })
    }
    traces.push({
      x: months,
      y: witnessZ,
      name: s.witnessSeries(witnessLabel ?? ''),
      color: 'muted',
      dash: 'dash',
      width: 2,
      axis: 'y2',
      label: witnessLabel ?? undefined,
    })
  }
  if (trendMonths && trendY) {
    traces.push({ x: trendMonths, y: trendY, name: s.senTrend, color: 'ink', width: 2.5, label: s.senTrend })
  }
  const hasAnnualMeans = Boolean(annualMeans && annualMeans.x.length > 0)
  if (annualMeans && hasAnnualMeans) {
    traces.push({
      x: annualMeans.x,
      y: annualMeans.y,
      name: s.annualMean,
      color: 'mean',
      mode: 'markers',
    })
  }
  const markers: ChartMarker[] =
    breakYear == null || !Number.isFinite(breakYear)
      ? []
      : [{ x: breakYearIso(breakYear), label: s.shift(Math.round(breakYear)) }]
  return (
    <ChartFrame
      title={s.title(displayUnit)}
      yTitle={displayUnit}
      yTitle2={showWitness && hasWitness ? s.zScore : undefined}
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
              {s.showWitness}
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
                {s.senTrend}
              </span>
            )}
            {trendBand && (
              <span className="chart-swatch">
                <span className="swatch swatch-band" />
                {s.band}
              </span>
            )}
            {hasAnnualMeans && (
              <span className="chart-swatch">
                <span className="swatch swatch-mean" />
                {s.annualMean}
              </span>
            )}
            {showWitness && hasWitness ? (
              <span className="chart-swatch">
                <span className="swatch swatch-muted" />
                {s.witnessLegend(witnessLabel ?? '', displayWitnessUnit)}
              </span>
            ) : null}
          </div>
          <p className="chart-note">{caption}</p>
          {showWitness && hasWitness ? (
            <p className="chart-note">{s.witnessNote}</p>
          ) : null}
        </>
      }
    />
  )
}
