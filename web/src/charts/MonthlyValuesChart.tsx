import { ChartFrame } from './ChartFrame'

interface MonthlyValuesChartProps {
  months: readonly string[]
  values: readonly (number | null)[]
  unit: string
  label: string
}

export function MonthlyValuesChart({ months, values, unit, label }: MonthlyValuesChartProps) {
  return (
    <ChartFrame
      title={`Monthly values (${unit})`}
      yTitle={unit}
      traces={[{ x: months, y: values, name: label, color: 'accent' }]}
      footer={
        <p className="chart-note">
          <span className="chart-swatch">
            <span className="swatch swatch-accent" />
            {label}
          </span>
        </p>
      }
    />
  )
}
