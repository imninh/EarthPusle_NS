import { useEffect, useRef, useState } from 'react'
import { N_COLS, N_ROWS } from '../../data/contract'
import { loadTrendClass } from '../../data/loaders'
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
        aria-label={`Global trend map for ${label}. Not cropped to the selected domain. Significant increase means ${increaseMeans}. Other cells are a significant decrease, not significant, insufficient data, or outside the domain.`}
      />
      {status === 'loading' ? <span className="screener-thumb-status">Loading map…</span> : null}
      {status === 'error' ? (
        <span className="screener-thumb-status" role="alert">
          {error ?? 'Could not draw this map.'}
        </span>
      ) : null}
      <span className="screener-open">Open map</span>
    </div>
  )
}
