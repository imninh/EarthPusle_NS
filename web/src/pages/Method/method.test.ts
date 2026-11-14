import { describe, expect, it } from 'vitest'
import {
  CHALLENGE_ROWS,
  CHECK_TOOLS,
  CHECK_TOOLS_SENTENCE,
  METHOD_DOC_LINKS,
  METHOD_LIMITATIONS,
  METHOD_STEPS,
  SHEET_TEXT,
  challengeHref,
  sentenceCount,
  sheetSourceLine,
} from './content'

describe('Method page content', () => {
  it('lists the eight pipeline steps in order', () => {
    expect(METHOD_STEPS.map((step) => step.id)).toEqual([
      'data',
      'anomalies',
      'trend',
      'fdr',
      'quality',
      'witness',
      'region',
      'interval',
    ])
  })

  it('gives every step two sentences, a technical name and a why', () => {
    for (const step of METHOD_STEPS) {
      expect(step.title.length).toBeGreaterThan(0)
      expect(step.technical.length).toBeGreaterThan(0)
      expect(sentenceCount(step.body)).toBe(2)
      expect(step.why.length).toBeGreaterThan(0)
    }
  })

  it('summarises limitations and links to repository docs', () => {
    expect(METHOD_LIMITATIONS.length).toBeGreaterThanOrEqual(4)
    expect(METHOD_DOC_LINKS.map((link) => link.label)).toEqual([
      'Scientific methodology',
      'Limitations',
      'Data contract',
    ])
    expect(METHOD_DOC_LINKS.every((link) => link.href.startsWith('../docs/'))).toBe(true)
  })

  it('counts sentence ends without the method name', () => {
    expect(sentenceCount('One. Two.')).toBe(2)
    expect(sentenceCount('One sentence without a full stop')).toBe(1)
    expect(sentenceCount('')).toBe(0)
  })
})

describe('challenge table', () => {
  it('covers the four objectives and the five considerations once each', () => {
    expect(CHALLENGE_ROWS.filter((row) => row.kind === 'Objective')).toHaveLength(4)
    expect(CHALLENGE_ROWS.filter((row) => row.kind === 'Consideration')).toHaveLength(5)
    expect(new Set(CHALLENGE_ROWS.map((row) => row.id)).size).toBe(CHALLENGE_ROWS.length)
  })

  it('keeps quoted phrases short and gives every row a place and a link', () => {
    for (const row of CHALLENGE_ROWS) {
      expect(row.phrase.split(/\s+/).length).toBeLessThanOrEqual(12)
      expect(row.where.length).toBeGreaterThan(0)
      expect(row.linkLabel.length).toBeGreaterThan(0)
    }
  })

  it('links only to existing hash routes', () => {
    const allowed = ['#/investigate', '#/screener', '#/discovery', '#/region', '#/story', '#/method']
    for (const row of CHALLENGE_ROWS) expect(allowed).toContain(challengeHref(row.page))
  })

  it('does not claim a feature that does not exist yet', () => {
    const text = CHALLENGE_ROWS.map((row) => row.where).join(' ').toLowerCase()
    expect(text).not.toContain('check it yourself')
  })
})

describe('tools to check our numbers', () => {
  it('lists the three tools over https and uses the agreed sentence', () => {
    expect(CHECK_TOOLS.map((tool) => tool.label)).toEqual([
      'Giovanni',
      'Hydrology Time Series',
      'KNMI Climate Explorer',
    ])
    expect(CHECK_TOOLS.every((tool) => tool.href.startsWith('https://'))).toBe(true)
    expect(CHECK_TOOLS_SENTENCE).toBe(
      'These tools draw and test one series at a time. EarthPulse adds screening across variables, correction for many tests, data-quality flags and a second dataset.',
    )
  })
})

describe('classroom sheet', () => {
  it('has three tasks in each language', () => {
    expect(SHEET_TEXT.en.tasks).toHaveLength(3)
    expect(SHEET_TEXT.vi.tasks).toHaveLength(3)
    expect(SHEET_TEXT.en.tasks[0]).toBe('Is your country getting warmer? Write the rate and its 95% interval.')
    expect(SHEET_TEXT.vi.tasks[0]).toBe('Nước bạn có đang ấm lên không? Ghi tốc độ thay đổi và khoảng tin cậy 95%.')
    expect(SHEET_TEXT.vi.tasks[2]).toContain('không có nghĩa là')
  })

  it('builds the source line from product names and DOIs without duplicates', () => {
    const line = sheetSourceLine('Data sources', [
      { product: 'Product A', version: '1.0', doi: '10.0000/a' },
      { product: 'Product A', version: '1.0', doi: '10.0000/a' },
      { product: 'Product B', version: '2', doi: null },
    ])
    expect(line).toBe('Data sources: Product A 1.0, DOI 10.0000/a; Product B 2')
    expect(sheetSourceLine('Nguồn dữ liệu', [])).toBe('Nguồn dữ liệu')
  })
})
