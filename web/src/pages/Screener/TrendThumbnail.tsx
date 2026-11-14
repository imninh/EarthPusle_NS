import { useEffect, useRef, useState } from 'react'
import { N_COLS, N_ROWS } from '../../data/contract'
import { loadTrendClass } from '../../data/loaders'
import { useStrings } from '../../i18n'
import { SCREENER_STRINGS } from './strings'
import { paintTrendClass, trendColoursFrom } from './thumbnail'

export function TrendThumbnail({
  variableId,
  windowId,
  label,
  increaseMeans,
}: {
  variableId: string
  windowId: string
  label: string
  increaseMeans: string
}) {
  const s = useStrings(SCREENER_STRINGS)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
    loadTrendClass(variableId, windowId)
      .then((grid) => {
        if (cancelled) return
        const node = canvasRef.current
        if (!node) throw new Error('Trend thumbnail is not on the page.')
        paintTrendClass(node, grid, trendColoursFrom(node))
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setStatus('error')
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [variableId, windowId])

  return (
    <div className="screener-thumb">
      <canvas
        ref={canvasRef}
        width={N_COLS}
        height={N_ROWS}
        role="img"
        aria-label={s.thumbAria(label, increaseMeans)}
      />
      {status === 'loading' ? <span className="screener-thumb-status">{s.thumbLoading}</span> : null}
      {status === 'error' ? (
        <span className="screener-thumb-status" role="alert">
          {error ?? s.thumbError}
        </span>
      ) : null}
      <span className="screener-open">{s.thumbOpen}</span>
    </div>
  )
}
