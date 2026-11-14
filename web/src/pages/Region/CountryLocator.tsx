import { useEffect, useRef, useState } from 'react'
import { N_COLS } from '../../data/contract'
import { loadCountryGrid } from '../../data/loaders'
import type { Country } from '../../data/types'
import { useStrings } from '../../i18n'
import { countryCellExtent } from './country'
import { LOCATOR_STRINGS } from './strings'

const WIDTH = 320
const HEIGHT = 170
const PAD = 10

type LocatorStatus = 'loading' | 'ready' | 'missing' | 'error'

function cssColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function drawCountry(canvas: HTMLCanvasElement, country: Country, grid: Int16Array): boolean {
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  const extent = countryCellExtent(grid, country.index)
  if (!extent) return false

  const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
  canvas.width = Math.round(WIDTH * ratio)
  canvas.height = Math.round(HEIGHT * ratio)
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, WIDTH, HEIGHT)

  const rows = extent.row1 - extent.row0 + 1
  const cols = extent.col1 - extent.col0 + 1
  const scale = Math.min((WIDTH - 2 * PAD) / cols, (HEIGHT - 2 * PAD) / rows)
  const drawnWidth = cols * scale
  const drawnHeight = rows * scale
  const left = (WIDTH - drawnWidth) / 2
  const top = (HEIGHT - drawnHeight) / 2
  const fill = cssColor('--accent', '#1f5fbf')
  const gap = cssColor('--surface', '#ffffff')
  const border = cssColor('--border', '#d8dde3')

  ctx.fillStyle = cssColor('--bg', '#f5f7f9')
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  ctx.strokeStyle = border
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, WIDTH - 1, HEIGHT - 1)

  ctx.fillStyle = fill
  ctx.strokeStyle = gap
  ctx.lineWidth = Math.min(1, scale * 0.08)
  for (let row = extent.row0; row <= extent.row1; row++) {
    for (let col = extent.col0; col <= extent.col1; col++) {
      if (grid[row * N_COLS + col] !== country.index) continue
      const x = left + (col - extent.col0) * scale
      const y = top + (row - extent.row0) * scale
      ctx.fillRect(x, y, scale, scale)
      ctx.strokeRect(x, y, scale, scale)
    }
  }
  return true
}

/** Small static canvas of the country's cells from `regions/country_grid.i16`. */
export function CountryLocator({ country }: { country: Country }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<LocatorStatus>('loading')
  const s = useStrings(LOCATOR_STRINGS)

  useEffect(() => {
    let cancelled = false
    loadCountryGrid()
      .then((grid) => {
        if (cancelled) return
        const canvas = canvasRef.current
        if (!canvas || !grid) {
          setStatus('missing')
          return
        }
        setStatus(drawCountry(canvas, country, grid) ? 'ready' : 'missing')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [country])

  return (
    <figure className="country-locator">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={s.ariaLabel(country.label)}
      />
      <figcaption>
        {status === 'loading' && s.loading}
        {status === 'ready' && s.ready(country.label, String(country.n_cells))}
        {status === 'missing' && s.missing}
        {status === 'error' && s.error}
      </figcaption>
    </figure>
  )
}
