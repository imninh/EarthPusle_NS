import { describe, expect, it } from 'vitest'
import { HOME_ROUTE, parseHash, serializeHash, type RouteState } from './urlState'

const route = (patch: Partial<RouteState>): RouteState => ({ ...HOME_ROUTE, ...patch })

describe('parseHash', () => {
  it('treats an empty or unknown hash as Home', () => {
    expect(parseHash('')).toEqual(HOME_ROUTE)
    expect(parseHash('#')).toEqual(HOME_ROUTE)
    expect(parseHash('#/not-a-page?v=x')).toEqual(HOME_ROUTE)
  })

  it('restores the documented discovery link', () => {
    expect(parseHash('#/discovery?v=precipitation&w=2001-2024&cell=66,192')).toEqual(
      route({
        page: 'discovery',
        variableId: 'precipitation',
        windowId: '2001-2024',
        selection: { kind: 'cell', row: 66, col: 192 },
      }),
    )
  })

  it('parses region and bbox selections and screener domains', () => {
    expect(parseHash('#/region?v=precipitation&region=mekong')).toEqual(
      route({
        page: 'region',
        variableId: 'precipitation',
        selection: { kind: 'region', regionId: 'mekong' },
      }),
    )
    expect(parseHash('#/region?bbox=-80,-20,-45,5')).toEqual(
      route({ page: 'region', selection: { kind: 'bbox', bbox: [-80, -20, -45, 5] } }),
    )
    expect(parseHash('#/screener?w=2001-2012&domain=country_704')).toEqual(
      route({ page: 'screener', windowId: '2001-2012', domain: 'country_704' }),
    )
    expect(parseHash('#/story?case=case-01')).toEqual(route({ page: 'story', caseId: 'case-01' }))
    expect(parseHash('#/discovery?v=air_temperature&w=2001-2024&layer=witness')).toEqual(
      route({ page: 'discovery', variableId: 'air_temperature', windowId: '2001-2024', layer: 'witness' }),
    )
    expect(parseHash('#/method')).toEqual(route({ page: 'method' }))
    expect(parseHash('#/investigate?w=2001-2024')).toEqual(
      route({ page: 'investigate', windowId: '2001-2024' }),
    )
    expect(
      parseHash('#/investigate?place=country_704&topic=heat&w=2001-2024&view=casefile'),
    ).toEqual(
      route({
        page: 'investigate',
        place: 'country_704',
        topic: 'heat',
        windowId: '2001-2024',
        view: 'casefile',
      }),
    )
  })

  it('keeps unknown investigate values as plain route fields', () => {
    expect(
      parseHash('#/investigate?place=not-a-place&topic=not-a-topic&view=not-a-view'),
    ).toEqual(
      route({
        page: 'investigate',
        place: 'not-a-place',
        topic: 'not-a-topic',
        view: 'not-a-view',
      }),
    )
  })

  it('ignores malformed selections and keeps the page', () => {
    expect(parseHash('#/discovery?cell=180,0')).toEqual(route({ page: 'discovery' }))
    expect(parseHash('#/discovery?cell=1,2,3')).toEqual(route({ page: 'discovery' }))
    expect(parseHash('#/region?bbox=1,2,3')).toEqual(route({ page: 'region' }))
    expect(parseHash('#/region?bbox=1,2,3,nope')).toEqual(route({ page: 'region' }))
    expect(parseHash('#/region?region=')).toEqual(route({ page: 'region' }))
  })

  it('accepts a leading slash and ignores unrelated parameters', () => {
    expect(parseHash('#/home?utm=abc')).toEqual(route({ page: 'home' }))
    expect(parseHash('#home')).toEqual(route({ page: 'home' }))
  })
})

describe('serializeHash', () => {
  it('produces a stable canonical string', () => {
    expect(serializeHash(HOME_ROUTE)).toBe('#/home')
    expect(
      serializeHash(
        route({
          page: 'discovery',
          variableId: 'precipitation',
          windowId: '2001-2024',
          selection: { kind: 'cell', row: 66, col: 192 },
        }),
      ),
    ).toBe('#/discovery?v=precipitation&w=2001-2024&cell=66,192')
  })

  it('drops the default screener domain and adds regions, bboxes and cases', () => {
    expect(serializeHash(route({ page: 'screener', variableId: 'x', windowId: 'w' }))).toBe(
      '#/screener?v=x&w=w',
    )
    expect(serializeHash(route({ page: 'screener', domain: 'global' }))).toBe('#/screener')
    expect(serializeHash(route({ page: 'screener', domain: 'country_704' }))).toBe(
      '#/screener?domain=country_704',
    )
    expect(serializeHash(route({ page: 'region', selection: { kind: 'region', regionId: 'mekong' } }))).toBe(
      '#/region?region=mekong',
    )
    expect(serializeHash(route({ page: 'region', selection: { kind: 'bbox', bbox: [-80, -20, -45, 5] } }))).toBe(
      '#/region?bbox=-80,-20,-45,5',
    )
    expect(serializeHash(route({ page: 'story', caseId: 'case-01' }))).toBe('#/story?case=case-01')
    expect(serializeHash(route({ page: 'investigate', windowId: '2001-2024', variableId: 'x' }))).toBe(
      '#/investigate?w=2001-2024',
    )
    expect(
      serializeHash(
        route({
          page: 'investigate',
          place: 'country_704',
          topic: 'heat',
          windowId: '2001-2024',
          view: 'casefile',
        }),
      ),
    ).toBe('#/investigate?place=country_704&topic=heat&w=2001-2024&view=casefile')
    expect(
      serializeHash(route({ page: 'discovery', variableId: 'x', windowId: 'w', layer: 'witness' })),
    ).toBe('#/discovery?v=x&w=w&layer=witness')
  })

  it('omits variable, window and selection where they do not apply', () => {
    expect(
      serializeHash(
        route({
          page: 'home',
          variableId: 'precipitation',
          windowId: '2001-2024',
          selection: { kind: 'cell', row: 1, col: 2 },
        }),
      ),
    ).toBe('#/home')
    expect(serializeHash(route({ page: 'story', selection: { kind: 'region', regionId: 'mekong' } }))).toBe(
      '#/story',
    )
  })

  it('round-trips every supported route', () => {
    const routes: RouteState[] = [
      route({ page: 'home' }),
      route({ page: 'screener', variableId: 'a', windowId: 'w', domain: 'mekong' }),
      route({
        page: 'discovery',
        variableId: 'a',
        windowId: 'w',
        selection: { kind: 'cell', row: 0, col: 359 },
      }),
      route({
        page: 'region',
        variableId: 'a',
        windowId: 'w',
        selection: { kind: 'bbox', bbox: [-1.5, 2, 3.25, 4] },
      }),
      route({ page: 'story', caseId: 'case-01' }),
      route({ page: 'method' }),
      route({ page: 'investigate', windowId: '2001-2024' }),
      route({
        page: 'investigate',
        place: 'country_704',
        topic: 'heat',
        windowId: '2001-2024',
        view: 'casefile',
      }),
      route({
        page: 'investigate',
        place: 'not-a-place',
        topic: 'not-a-topic',
        view: 'not-a-view',
      }),
    ]
    for (const value of routes) expect(parseHash(serializeHash(value))).toEqual(value)
  })
})
