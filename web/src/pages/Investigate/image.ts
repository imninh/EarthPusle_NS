// "Download image": a 1200 x 630 PNG of the report header and the top three cards,
// drawn by hand on a canvas (no dependency). Words and numbers come from the same
// models as the page; nothing is computed here except bar widths.
import type { CardModel } from './model'
import { formatPercent } from './model'
import { wrapLines, type ReportHeader } from './report'

export const IMAGE_WIDTH = 1200
export const IMAGE_HEIGHT = 630

interface Palette {
  night: string
  night2: string
  onNight: string
  onNightMuted: string
  marker: string
  markerInk: string
  increase: string
  decrease: string
  neutral: string
}

const FALLBACK: Palette = {
  night: '#0b1b33',
  night2: '#13294a',
  onNight: '#eaf1fb',
  onNightMuted: '#a9b8cf',
  marker: '#f2c230',
  markerInk: '#3d2e00',
  increase: '#ef7d63',
  decrease: '#6db3ea',
  neutral: '#3a4656',
}

/** The image is always night, so the light-mode warm/cool pair is replaced by the dark-mode pair. */
function readPalette(): Palette {
  return { ...FALLBACK }
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let out = text
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1)
  return `${out}…`
}

export interface ImageInput {
  header: ReportHeader
  topic: string
  cards: readonly CardModel[]
  url: string
}

export function drawReportImage(canvas: HTMLCanvasElement, input: ImageInput): void {
  const p = readPalette()
  canvas.width = IMAGE_WIDTH
  canvas.height = IMAGE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available in this browser.')

  const sans = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  const mono = 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace'
  const pad = 56

  ctx.fillStyle = p.night
  ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT)
  ctx.textBaseline = 'alphabetic'

  // Header
  ctx.fillStyle = p.onNightMuted
  ctx.font = `600 18px ${sans}`
  ctx.fillText('EARTHPULSE · COUNTRY REPORT', pad, 62)
  ctx.fillStyle = p.onNight
  ctx.font = `700 46px ${sans}`
  ctx.fillText(fit(ctx, input.header.title, IMAGE_WIDTH - pad * 2), pad, 116)
  ctx.fillStyle = p.onNightMuted
  ctx.font = `400 20px ${sans}`
  ctx.fillText(
    fit(ctx, `${input.topic} · ${input.header.credit} · ${input.header.exportLine}`, IMAGE_WIDTH - pad * 2),
    pad,
    150,
  )

  // Top three cards
  const cards = input.cards.slice(0, 3)
  const top = 184
  const gap = 20
  const cardW = (IMAGE_WIDTH - pad * 2 - gap * 2) / 3
  const cardH = 336
  cards.forEach((card, i) => {
    const x = pad + i * (cardW + gap)
    ctx.fillStyle = p.night2
    ctx.fillRect(x, top, cardW, cardH)
    const caution = card.verdict.tone === 'warn'
    if (caution) {
      ctx.fillStyle = p.marker
      ctx.fillRect(x, top, 6, cardH)
    }
    const inner = cardW - 40
    const tx = x + 24
    ctx.fillStyle = p.onNightMuted
    ctx.font = `600 15px ${sans}`
    ctx.fillText(fit(ctx, card.label.toUpperCase(), inner), tx, top + 36)

    // Verdict as text in a box; marker yellow only for caution.
    ctx.font = `800 15px ${sans}`
    const verdict = fit(ctx, card.verdict.label.toUpperCase(), inner - 20)
    const vw = ctx.measureText(verdict).width + 20
    if (caution) {
      ctx.fillStyle = p.marker
      ctx.fillRect(tx, top + 52, vw, 30)
      ctx.fillStyle = p.markerInk
    } else {
      ctx.strokeStyle = p.onNight
      ctx.lineWidth = 2
      ctx.strokeRect(tx + 1, top + 53, vw - 2, 28)
      ctx.fillStyle = p.onNight
    }
    ctx.fillText(verdict, tx + 10, top + 73)

    ctx.fillStyle = p.onNight
    ctx.font = `700 24px ${sans}`
    const lines = wrapLines(card.headline, inner, (s) => ctx.measureText(s).width, 4)
    lines.forEach((line, n) => ctx.fillText(line, tx, top + 126 + n * 31))

    // Warm/cool bar: increase from the left, decrease from the right.
    const by = top + cardH - 76
    const inc = Math.max(0, Math.min(1, card.sigIncrease ?? 0))
    const dec = Math.max(0, Math.min(1, card.sigDecrease ?? 0))
    ctx.fillStyle = p.neutral
    ctx.fillRect(tx, by, inner, 16)
    ctx.fillStyle = p.increase
    ctx.fillRect(tx, by, inner * inc, 16)
    ctx.fillStyle = p.decrease
    ctx.fillRect(tx + inner * (1 - dec), by, inner * dec, 16)
    ctx.font = `600 16px ${mono}`
    ctx.fillStyle = p.increase
    ctx.textAlign = 'left'
    ctx.fillText(`↑ ${formatPercent(card.sigIncrease, 1)}`, tx, by + 44)
    ctx.fillStyle = p.decrease
    ctx.textAlign = 'right'
    ctx.fillText(`↓ ${formatPercent(card.sigDecrease, 1)}`, tx + inner, by + 44)
    ctx.textAlign = 'left'
  })

  if (cards.length === 0) {
    ctx.fillStyle = p.onNightMuted
    ctx.font = `400 24px ${sans}`
    ctx.fillText(input.header.summary, pad, top + 40)
  }

  // Footer with the page URL
  ctx.fillStyle = p.onNightMuted
  ctx.font = `400 16px ${mono}`
  ctx.fillText(fit(ctx, input.url, IMAGE_WIDTH - pad * 2), pad, IMAGE_HEIGHT - 52)
  ctx.font = `400 14px ${sans}`
  ctx.fillText(
    fit(ctx, `${input.header.limitation} Warm = increase, cool = decrease.`, IMAGE_WIDTH - pad * 2),
    pad,
    IMAGE_HEIGHT - 26,
  )
}

/** Draw and download as `earthpulse-<slug>.png`. Rejects if the browser cannot make a PNG. */
export function downloadReportImage(input: ImageInput, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement('canvas')
      drawReportImage(canvas, input)
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('The browser could not create the image.'))
          return
        }
        const href = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = href
        link.download = filename
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(href), 1000)
        resolve()
      }, 'image/png')
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}
