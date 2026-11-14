export interface VerdictStampProps {
  /** The existing plainVerdict label, unchanged. Uppercased by CSS only. */
  label: string
  tone: 'strong' | 'caution' | 'not-yet' | 'none'
  size?: 'md' | 'lg'
}

/** Rotated verdict stamp. Real text, no role="status". Marker yellow means caution only. */
export function VerdictStamp({ label, tone, size = 'md' }: VerdictStampProps) {
  const sizeClass = size === 'lg' ? ' ui-stamp--lg' : ''
  return <span className={`ui-stamp ui-stamp--${tone}${sizeClass}`}>{label}</span>
}
