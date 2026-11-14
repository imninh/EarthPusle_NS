import { ChartFrame } from './ChartFrame'

interface ComparisonChartProps {
  months: readonly string[]
  seriesA: readonly (number | null)[]
  seriesB: readonly (number | null)[]
  labelA: string
  labelB: string
  rhoLabel: string
}

export function ComparisonChart({ months, seriesA, seriesB, labelA, labelB, rhoLabel }: ComparisonChartProps) {
  return (
    <ChartFrame
      title="Anomaly comparison"
      yTitle="z-score"
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
          <p className="chart-note">standardized for comparison</p>
          <p className="chart-note">{rhoLabel}</p>
        </>
      }
    />
  )
}
