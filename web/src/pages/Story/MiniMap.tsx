import { useEffect, useRef, useState } from 'react'
import { N_COLS, N_ROWS, latToRow, lonToCol } from '../../data/contract'
import { loadTrendClass } from '../../data/loaders'
import { useStrings } from '../../i18n'
import { paintTrendClass, trendColoursFrom } from '../Screener/thumbnail'
import { MAP_STRINGS } from './strings'

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function drawBbox(canvas: HTMLCanvasElement, bbox: [number, number, number, number]) {
  const context = canvas.getContext('2d')
  if (!context) return
  const [west, south, east, north] = bbox
  const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#1f5fbf'
  const rowTop = clamp(latToRow(north), 0, N_ROWS - 1)
  const rowBottom = clamp(latToRow(south), 0, N_ROWS - 1)
  const top = Math.min(rowTop, rowBottom)
  const height = Math.max(1, Math.abs(rowBottom - rowTop))
  const x1 = clamp(lonToCol(west), 0, N_COLS - 1)
  const x2 = clamp(lonToCol(east), 0, N_COLS - 1)
  const spans: [number, number][] =
    west <= east
      ? [[Math.min(x1, x2), Math.max(1, Math.abs(x2 - x1))]]
      : [
          [x1, Math.max(1, N_COLS - x1)],
          [0, Math.max(1, x2)],
        ]
  context.save()
  context.strokeStyle = accent
  context.lineWidth = 2
  context.setLineDash([4, 2])
  for (const [x, width] of spans) {
    context.strokeRect(x + 0.5, top + 0.5, width - 1, height - 1)
  }
  context.restore()
}

/** Small global trend map with the case's approximate box outlined. */
export function CaseMiniMap({
  variableId,
  windowId,
  bbox,
  label,
  caption,
}: {
  variableId: string
  windowId: string
  bbox: [number, number, number, number]
  label: string
  caption?: string | null
}) {
  const s = useStrings(MAP_STRINGS)
  const shownCaption = caption === undefined ? s.defaultCaption : caption
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    loadTrendClass(variableId, windowId)
      .then((grid) => {
        if (cancelled) return
        const node = canvasRef.current
        if (!node) return
        paintTrendClass(node, grid, trendColoursFrom(node))
        drawBbox(node, bbox)
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
  }, [variableId, windowId, bbox])

  return (
    <figure className="story-map">
      <canvas
        ref={canvasRef}
        width={N_COLS}
        height={N_ROWS}
        role="img"
        aria-label={
          shownCaption ? s.ariaBox(label) : s.ariaArea(label)
        }
      />
      {status === 'loading' ? <figcaption>{s.loading}</figcaption> : null}
      {status === 'error' ? (
        <figcaption role="alert">{error ?? s.failed}</figcaption>
      ) : null}
      {shownCaption ? <figcaption>{shownCaption}</figcaption> : null}
    </figure>
  )
}
