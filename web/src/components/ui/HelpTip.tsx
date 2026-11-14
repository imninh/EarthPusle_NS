import type { ReactNode } from 'react'

/**
 * Inline help bubble. Visible on hover and keyboard focus, so it is not pointer-only.
 * The trigger keeps a text label for screen readers. When the visible content is
 * composed of elements, pass the same words in `description` so the accessible
 * name is not "[object Object]".
 */
export function HelpTip({
  label,
  children,
  description,
}: {
  label: string
  children: ReactNode
  /** Plain-text copy of the bubble for `aria-label`. Defaults to `children` when it is a string. */
  description?: string
}) {
  const hint = description ?? (typeof children === 'string' ? children : '')
  return (
    <span className="ui-help" tabIndex={0} role="note" aria-label={hint ? `${label}. ${hint}` : label}>
      <span aria-hidden="true">?</span>
      <span className="ui-help-panel" role="tooltip">
        {children}
      </span>
    </span>
  )
}
