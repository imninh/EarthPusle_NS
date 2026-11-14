import { describe, expect, it } from 'vitest'
import * as EN from './content'
import * as VI from './content.vi'
import { METHOD_STRINGS } from './strings'

describe('Method strings', () => {
  it('has every key in both languages with the same type and a non-empty value', () => {
    const en = METHOD_STRINGS.en as Record<string, unknown>
    const vi = METHOD_STRINGS.vi as Record<string, unknown>
    expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(en)) {
      expect(typeof vi[key], key).toBe(typeof en[key])
      if (typeof en[key] === 'string') {
        expect((en[key] as string).length, key).toBeGreaterThan(0)
        expect((vi[key] as string).length, key).toBeGreaterThan(0)
      }
    }
  })
})

describe('Vietnamese Method content', () => {
  it('has the same step ids in the same order and non-empty text', () => {
    expect(VI.METHOD_STEPS.map((s) => s.id)).toEqual(EN.METHOD_STEPS.map((s) => s.id))
    for (const step of VI.METHOD_STEPS) {
      expect(step.title.length).toBeGreaterThan(0)
      expect(step.technical.length).toBeGreaterThan(0)
      expect(step.body.length).toBeGreaterThan(0)
      expect(step.why.length).toBeGreaterThan(0)
    }
  })

  it('has the same number of limitations and non-empty text', () => {
    expect(VI.METHOD_LIMITATIONS).toHaveLength(EN.METHOD_LIMITATIONS.length)
    expect(VI.METHOD_LIMITATIONS.every((text) => text.length > 0)).toBe(true)
  })

  it('has the same documentation links', () => {
    expect(VI.METHOD_DOC_LINKS.map((l) => l.href)).toEqual(EN.METHOD_DOC_LINKS.map((l) => l.href))
  })

  it('has the same challenge rows, kinds and target pages', () => {
    expect(VI.CHALLENGE_ROWS.map((r) => r.id)).toEqual(EN.CHALLENGE_ROWS.map((r) => r.id))
    expect(VI.CHALLENGE_ROWS.map((r) => [r.kind, r.page])).toEqual(EN.CHALLENGE_ROWS.map((r) => [r.kind, r.page]))
    for (const row of VI.CHALLENGE_ROWS) {
      expect(row.phrase.length).toBeGreaterThan(0)
      expect(row.where.length).toBeGreaterThan(0)
      expect(row.linkLabel.length).toBeGreaterThan(0)
    }
  })

  it('has the same tool URLs and a non-empty sentence', () => {
    expect(VI.CHECK_TOOLS.map((t) => t.href)).toEqual(EN.CHECK_TOOLS.map((t) => t.href))
    expect(VI.CHECK_TOOLS_SENTENCE.length).toBeGreaterThan(0)
  })

  it('keeps method names, datasets and numbers in every step', () => {
    for (const [index, step] of EN.METHOD_STEPS.entries()) {
      const vi = VI.METHOD_STEPS[index]
      if (!vi) throw new Error('missing step')
      for (const token of step.body.match(/GLDAS-2\.1|MERRA-2|GPCP|IMERG|2001–2020|95%|1°|Pettitt|Benjamini–Hochberg/g) ?? []) {
        expect(vi.body, `${step.id}: ${token}`).toContain(token)
      }
    }
  })
})
