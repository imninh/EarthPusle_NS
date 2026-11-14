import { formatUnit } from '../lib/format'
import { ChartFrame } from './ChartFrame'

interface MonthlyValuesChartProps {
  months: readonly string[]
  values: readonly (number | null)[]
  unit: string
  label: string
}

export function MonthlyValuesChart({ months, values, unit, label }: MonthlyValuesChartProps) {
  const displayUnit = formatUnit(unit)
  return (
    <ChartFrame
      title={`Monthly values (${displayUnit})`}
      yTitle={displayUnit}
      traces={[{ x: months, y: values, name: label, color: 'accent', label }]}
    />
  )
}
