import { formatUnit } from '../lib/format'
import { defineStrings, useStrings } from '../i18n'
import { ChartFrame } from './ChartFrame'

export const STRINGS = defineStrings(
  { title: (unit: string) => `Monthly values (${unit})` },
  { title: (unit: string) => `Giá trị theo tháng (${unit})` },
)

interface MonthlyValuesChartProps {
  months: readonly string[]
  values: readonly (number | null)[]
  unit: string
  label: string
}

export function MonthlyValuesChart({ months, values, unit, label }: MonthlyValuesChartProps) {
  const s = useStrings(STRINGS)
  const displayUnit = formatUnit(unit)
  return (
    <ChartFrame
      title={s.title(displayUnit)}
      yTitle={displayUnit}
      traces={[{ x: months, y: values, name: label, color: 'accent', label }]}
    />
  )
}
