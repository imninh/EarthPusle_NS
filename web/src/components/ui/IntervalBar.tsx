export interface IntervalBarProps {
  /** Raw numbers, used for positions only. */
  value: number
  lower: number
  upper: number
  /** Already formatted by the caller. This component never formats a number. */
  valueLabel: string
  lowerLabel: string
  upperLabel: string
  /** Colour of the range and the dot. */
  direction: 'increase' | 'decrease' | 'none'
  /** e.g. "95% interval does not cross zero"; also the accessible name of the graphic. */
  summary: string
}

export interface IntervalBarLayout {
  /** Positions as a share of the bar width, 0 to 1. */
  zero: number
  value: number
  lower: number
  upper: number
}

/**
 * Pure layout. Scale: symmetric around zero when the interval crosses it, otherwise from
 * zero to 1.15 x the far end. Returns null when an input is not finite.
 */
export function intervalLayout(value: number, lower: number, upper: number): IntervalBarLayout | null {
  if (![value, lower, upper].every(Number.isFinite)) return null
  const lo = Math.min(lower, upper)
  const hi = Math.max(lower, upper)
  let min: number
  let max: number
  if (lo < 0 && hi > 0) {
    const half = Math.max(Math.abs(lo), hi, Math.abs(value))
    min = -half
    max = half
  } else if (hi <= 0 && lo < 0) {
    min = Math.min(lo, value, 0) * 1.15
    max = 0
  } else if (hi > 0) {
    min = 0
    max = Math.max(hi, value, 0) * 1.15
  } else {
    // Everything is exactly zero: draw a neutral symmetric scale.
    min = -1
    max = 1
  }
  const span = max - min
  const at = (x: number) => Math.min(1, Math.max(0, (x - min) / span))
  return { zero: at(0), value: at(value), lower: at(lo), upper: at(hi) }
}

/** A rate with its 95% interval and a zero line, so "does it cross zero?" can be seen. */
export function IntervalBar({
  value,
  lower,
  upper,
  valueLabel,
  lowerLabel,
  upperLabel,
  direction,
  summary,
}: IntervalBarProps) {
  const layout = intervalLayout(value, lower, upper)
  if (!layout) return null
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`
  return (
    <div className={`ui-ibar ui-ibar--${direction}`}>
      <div className="ui-ibar-track" role="img" aria-label={summary}>
        <div className="ui-ibar-axis" />
        <div className="ui-ibar-zero" style={{ left: pct(layout.zero) }} />
        <div
          className="ui-ibar-range"
          style={{ left: pct(layout.lower), width: pct(layout.upper - layout.lower) }}
        />
        <div className="ui-ibar-dot" style={{ left: pct(layout.value) }} />
      </div>
      <div className="ui-ibar-labels">
        <span>{lowerLabel}</span>
        <strong>{valueLabel}</strong>
        <span>{upperLabel}</span>
      </div>
    </div>
  )
}
