import type { ReactNode } from 'react'

/**
 * Inline help bubble. Visible on hover and keyboard focus, so it is not pointer-only.
 * The trigger keeps a text label for screen readers.
 */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="ui-help" tabIndex={0} role="note" aria-label={`${label}. ${children}`}>
      <span aria-hidden="true">?</span>
      <span className="ui-help-panel" role="tooltip">
        {children}
      </span>
    </span>
  )
}
