import { defineStrings, useStrings } from '../i18n'
import { ChartFrame } from './ChartFrame'

export const STRINGS = defineStrings(
  { title: 'Anomaly comparison', zScore: 'z-score', note: 'standardized for comparison' },
  {
    title: 'So sánh độ lệch so với mức trung bình',
    zScore: 'điểm z',
    note: 'đã chuẩn hóa để so sánh',
  },
)

interface ComparisonChartProps {
  months: readonly string[]
  seriesA: readonly (number | null)[]
  seriesB: readonly (number | null)[]
  labelA: string
  labelB: string
  rhoLabel: string
}

export function ComparisonChart({ months, seriesA, seriesB, labelA, labelB, rhoLabel }: ComparisonChartProps) {
  const s = useStrings(STRINGS)
  return (
    <ChartFrame
      title={s.title}
      yTitle={s.zScore}
      traces={[
        { x: months, y: seriesA, name: labelA, color: 'accent', label: labelA },
        { x: months, y: seriesB, name: labelB, color: 'muted', dash: 'dash', label: labelB },
      ]}
      footer={
        <>
          <div className="chart-swatches chart-swatches--narrow">
            <span className="chart-swatch">
              <span className="swatch swatch-accent" />
              {labelA}
            </span>
            <span className="chart-swatch">
              <span className="swatch swatch-muted" />
              {labelB}
            </span>
          </div>
          <p className="chart-note">{s.note}</p>
          <p className="chart-note">{rhoLabel}</p>
        </>
      }
    />
  )
}
