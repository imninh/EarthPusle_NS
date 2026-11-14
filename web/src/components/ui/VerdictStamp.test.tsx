import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VerdictStamp } from './VerdictStamp'

describe('VerdictStamp', () => {
  it('renders the label as real text with the tone class', () => {
    const html = renderToStaticMarkup(<VerdictStamp label="Read with caution" tone="caution" />)
    expect(html).toContain('>Read with caution<')
    expect(html).toContain('ui-stamp--caution')
    expect(html).not.toContain('role=')
  })
  it('maps every tone to its own class', () => {
    for (const tone of ['strong', 'caution', 'not-yet', 'none'] as const) {
      expect(renderToStaticMarkup(<VerdictStamp label="x" tone={tone} />)).toContain(`ui-stamp--${tone}`)
    }
  })
  it('adds the large size only when asked', () => {
    expect(renderToStaticMarkup(<VerdictStamp label="x" tone="strong" size="lg" />)).toContain('ui-stamp--lg')
    expect(renderToStaticMarkup(<VerdictStamp label="x" tone="strong" />)).not.toContain('ui-stamp--lg')
  })
})
