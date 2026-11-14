import type { ReactNode } from 'react'

export interface ExhibitProps {
  /** e.g. "Exhibit A · Rate of change" (rendered as a small-caps label). */
  label: string
  /** The big mono number, already formatted by the caller. */
  value?: ReactNode
  /** Already formatted (formatUnit) by the caller. */
  unit?: string
  tone?: 'default' | 'caution' | 'increase' | 'decrease'
  /** One plain sentence and/or an IntervalBar. */
  children?: ReactNode
  /** Optional Disclosure ("How we know"). */
  footer?: ReactNode
}

/** A labelled piece of evidence on a paper card. */
export function Exhibit({ label, value, unit, tone = 'default', children, footer }: ExhibitProps) {
  const hasValue = value !== undefined && value !== null && value !== ''
  return (
    <section className={`ui-exhibit ui-exhibit--${tone}`} aria-label={label}>
      <p className="ui-exhibit-label label-caps">{label}</p>
      {hasValue ? (
        <div className="ui-exhibit-figure">
          <span className="ui-exhibit-value">{value}</span>
          {unit ? <span className="ui-exhibit-unit">{unit}</span> : null}
        </div>
      ) : null}
      {children ? <div className="ui-exhibit-body">{children}</div> : null}
      {footer ? <div className="ui-exhibit-footer">{footer}</div> : null}
    </section>
  )
}
