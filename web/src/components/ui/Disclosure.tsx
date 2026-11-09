import type { ReactNode } from 'react'

/** Collapsed explanation block. Keeps the ranking visible on a laptop screen. */
export function Disclosure({
  summary,
  children,
  className = '',
}: {
  summary: string
  children: ReactNode
  className?: string
}) {
  return (
    <details className={`ui-disclosure${className ? ` ${className}` : ''}`}>
      <summary>{summary}</summary>
      <div className="ui-disclosure-body">{children}</div>
    </details>
  )
}
