import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Exhibit } from './Exhibit'

describe('Exhibit', () => {
  it('renders label, value, unit, body and footer inside a labelled section', () => {
    const html = renderToStaticMarkup(
      <Exhibit label="Exhibit A · Rate" value="VAL" unit="UNIT" tone="caution" footer={<i>FOOT</i>}>
        <p>BODY</p>
      </Exhibit>,
    )
    expect(html).toContain('<section')
    expect(html).toContain('aria-label="Exhibit A · Rate"')
    expect(html).toContain('ui-exhibit--caution')
    for (const t of ['Exhibit A · Rate', 'VAL', 'UNIT', 'BODY', 'FOOT']) expect(html).toContain(t)
  })
  it('omits the figure when there is no value and defaults the tone', () => {
    const html = renderToStaticMarkup(<Exhibit label="L">text</Exhibit>)
    expect(html).not.toContain('ui-exhibit-figure')
    expect(html).toContain('ui-exhibit--default')
  })
})
