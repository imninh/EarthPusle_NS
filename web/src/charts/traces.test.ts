import { describe, expect, it } from 'vitest'
import { readChartColors } from './theme'
import {
  BAND_OPACITY,
  BAR_OPACITY,
  barSegment,
  buildPlotData,
  directLabels,
  markerAnnotations,
  markerShapes,
  segmentTrace,
  wrapLabel,
  type ChartTrace,
} from './traces'

const colors = readChartColors()
const months = ['2020-01', '2020-02', '2020-03', '2020-04']

describe('barSegment', () => {
  const trace: ChartTrace = { x: months, y: [1, -2, null, 0], name: 'a', color: 'accent', mode: 'bars' }
  it('colors warm at or above zero and cool below, keeps values', () => {
    const bar = barSegment(trace, colors, 'y')
    expect(bar.type).toBe('bar')
    expect(bar.y).toEqual([1, -2, null, 0])
    const marker = bar.marker!.color as string[]
    expect(marker[0]).toBe(marker[3])
    expect(marker[0]).not.toBe(marker[1])
    expect(marker[0]).toContain(String(BAR_OPACITY))
  })
  it('segmentTrace delegates bars', () => {
    expect(segmentTrace(trace, '#000', 'y', colors)).toHaveLength(1)
  })
})

describe('line segments', () => {
  it('splits at gaps and applies dash and width', () => {
    const trace: ChartTrace = { x: months, y: [1, null, 2, 3], name: 'b', color: 'muted', dash: 'dash', width: 2 }
    const segments = segmentTrace(trace, '#111', 'y2', colors)
    expect(segments).toHaveLength(2)
    expect(segments[0].mode).toBe('markers')
    expect(segments[1].line).toEqual({ color: '#111', width: 2, dash: 'dash' })
    expect(segments[1].yaxis).toBe('y2')
  })
})

describe('band and plot data', () => {
  const trace: ChartTrace = { x: months, y: [1, 2, 3, 4], name: 'c', color: 'ink' }
  it('puts the interval fill first at 10% ink', () => {
    const data = buildPlotData([trace], colors, { months, lower: [0, 1, 2, 3], upper: [2, 3, 4, 5] })
    expect(data).toHaveLength(3)
    expect(data[1].fill).toBe('tonexty')
    expect(data[1].fillcolor).toContain(String(BAND_OPACITY))
  })
  it('adds no band without an interval', () => {
    expect(buildPlotData([trace], colors, null)).toHaveLength(1)
  })
})

describe('break marker and direct labels', () => {
  it('draws a 3 px marker line and a tag', () => {
    const marker = [{ x: '2012-06-01', label: 'sudden shift ≈ 2012' }]
    expect(markerShapes(marker, colors)[0].line).toEqual({ color: colors.marker, width: 3 })
    expect(markerAnnotations(marker, colors)[0].text).toBe('sudden shift ≈ 2012')
    expect(markerShapes([], colors)).toEqual([])
  })
  it('labels the last valid point of labelled traces only', () => {
    const traces: ChartTrace[] = [
      { x: months, y: [1, 2, null, null], name: 'a', color: 'accent', label: 'A' },
      { x: months, y: [1, 2, 3, 4], name: 'b', color: 'muted' },
    ]
    const labels = directLabels(traces, colors)
    expect(labels).toHaveLength(1)
    expect(labels[0]).toMatchObject({ x: 1, xref: 'paper', y: 2, text: 'A' })
  })
})

describe('wrapLabel', () => {
  it('wraps at spaces', () => {
    expect(wrapLabel('Near-surface air temperature (model)', 17)).toBe('Near-surface air<br>temperature<br>(model)')
    expect(wrapLabel('Sen trend')).toBe('Sen trend')
  })
})
