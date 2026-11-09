import type { HTMLAttributes } from 'react'

/** A surface for related content. Visual styling lives in index.css (.ui-card). */
export function Card({ className = '', ...rest }: HTMLAttributes<HTMLElement>) {
  return <article className={`ui-card${className ? ` ${className}` : ''}`} {...rest} />
}
