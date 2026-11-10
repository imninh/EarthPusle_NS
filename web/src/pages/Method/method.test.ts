import { describe, expect, it } from 'vitest'
import {
  METHOD_DOC_LINKS,
  METHOD_LIMITATIONS,
  METHOD_STEPS,
  sentenceCount,
} from './content'

describe('Method page content', () => {
  it('lists the six pipeline steps in order', () => {
    expect(METHOD_STEPS.map((step) => step.id)).toEqual([
      'data',
      'anomalies',
      'trend',
      'fdr',
      'quality',
      'witness',
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
