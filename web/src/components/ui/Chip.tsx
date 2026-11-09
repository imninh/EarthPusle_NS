import type { ReactNode } from 'react'

export type ChipTone = 'default' | 'accent' | 'warn' | 'good'

/** Small status label. Wording should stay descriptive, never a verdict. */
export function Chip({
  children,
  tone = 'default',
  className = '',
  title,
}: {
  children: ReactNode
  tone?: ChipTone
  className?: string
  title?: string
}) {
  return (
    <span className={`ui-chip ui-chip-${tone}${className ? ` ${className}` : ''}`} title={title}>
      {children}
    </span>
  )
}
