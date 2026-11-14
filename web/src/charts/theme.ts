import { useEffect, useState } from 'react'

export interface ChartColors {
  text: string
  muted: string
  border: string
  surface: string
  accent: string
  secondary: string
  ink: string
  increase: string
  decrease: string
  marker: string
  markerInk: string
  mono: string
}

const FALLBACK: ChartColors = {
  text: '#1b1f24',
  muted: '#5b6573',
  border: '#d8dde3',
  surface: '#ffffff',
  accent: '#1f5fbf',
  secondary: '#2471a3',
  ink: '#16202e',
  increase: '#c8452c',
  decrease: '#1f6fb2',
  marker: '#f2c230',
  markerInk: '#3d2e00',
  mono: "ui-monospace, 'Cascadia Mono', Consolas, 'SF Mono', Menlo, monospace",
}

export function readChartColors(): ChartColors {
  if (typeof document === 'undefined') return FALLBACK
  const style = getComputedStyle(document.documentElement)
  const pick = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    text: pick('--text', FALLBACK.text),
    muted: pick('--muted', FALLBACK.muted),
    border: pick('--border', FALLBACK.border),
    surface: pick('--surface', FALLBACK.surface),
    accent: pick('--accent', FALLBACK.accent),
    secondary: pick('--decrease', FALLBACK.secondary),
    ink: pick('--ink', FALLBACK.ink),
    increase: pick('--increase', FALLBACK.increase),
    decrease: pick('--decrease', FALLBACK.decrease),
    marker: pick('--marker', FALLBACK.marker),
    markerInk: pick('--marker-ink', FALLBACK.markerInk),
    mono: pick('--font-mono', FALLBACK.mono),
  }
}

export function useChartColors(): ChartColors {
  const [colors, setColors] = useState(readChartColors)
  useEffect(() => {
    const apply = () => setColors(readChartColors())
    apply()
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    query.addEventListener('change', apply)
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(apply)
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    return () => {
      query.removeEventListener('change', apply)
      observer?.disconnect()
    }
  }, [])
  return colors
}

export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim()
  if (hex.startsWith('#')) {
    const body = hex.slice(1)
    const full = body.length === 3 ? [...body].map((char) => char + char).join('') : body
    const value = Number.parseInt(full, 16)
    if (!Number.isFinite(value) || full.length !== 6) return color
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
  }
  const match = hex.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
  if (match) return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`
  return color
}

export function monthIso(month: string): string {
  return month.length === 7 ? `${month}-01` : month
}

/** First day of the month after `month`, so a window band includes the end month. */
export function monthAfterIso(month: string): string {
  const [yearText, monthText] = month.split('-')
  const year = Number(yearText)
  const value = Number(monthText)
  if (value === 12) return `${year + 1}-01-01`
  return `${year}-${String(value + 1).padStart(2, '0')}-01`
}
