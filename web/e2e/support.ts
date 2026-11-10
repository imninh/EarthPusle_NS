import { expect, type ConsoleMessage, type Page } from '@playwright/test'

export interface ConsoleSink {
  errors: string[]
}

/** Record uncaught exceptions and console errors. Benign browser noise is ignored. */
export function trackConsole(page: Page): ConsoleSink {
  const sink: ConsoleSink = { errors: [] }
  const ignore = /Download the React DevTools|favicon\.ico/i
  page.on('pageerror', (error) => {
    sink.errors.push(`pageerror: ${error.message}`)
  })
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (ignore.test(text)) return
    sink.errors.push(`console: ${text}`)
  })
  return sink
}

export function assertClean(sink: ConsoleSink, step: string): void {
  expect(sink.errors, `${step}\n${sink.errors.join('\n')}`).toEqual([])
}

/** Positive when the document is wider than the viewport. */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement
    const body = document.body
    const width = Math.max(root.scrollWidth, body?.scrollWidth ?? 0)
    const viewport = root.clientWidth
    return width - viewport
  })
}

/**
 * A control is reachable when it sits inside the viewport horizontally.
 * Vertical position may be below the fold; the caller scrolls it into view first
 * without counting a sideways scroll as success.
 */
export async function controlOffscreen(page: Page, name: string): Promise<string | null> {
  const target = page
    .getByRole('button', { name })
    .or(page.getByRole('radio', { name }))
    .or(page.getByRole('combobox', { name }))
    .first()
  if ((await target.count()) === 0) return `${name}: not in the page`
  await target.evaluate((node) => {
    node.scrollIntoView({ block: 'center', inline: 'nearest' })
  })
  const box = await target.boundingBox()
  if (!box) return `${name}: no box`
  const viewport = page.viewportSize()
  if (!viewport) return `${name}: no viewport`
  if (box.x < -1 || box.x + box.width > viewport.width + 1) {
    return `${name}: x=${Math.round(box.x)} width=${Math.round(box.width)} viewport=${viewport.width}`
  }
  return null
}
