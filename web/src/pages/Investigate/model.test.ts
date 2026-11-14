// P20 model tests. Pure rules first, then the two acceptance guards on the
// published files: the headline share must equal the screener row, and Vietnam +
// Heat must carry the caution line and find the Vietnam case.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CasesFile, DataIndex, DetectiveCase, ScreenerRow, VariableMeta } from '../../data/types'
import { GLOSSARY } from '../../lib/format'
import {
  ALL_TOPIC,
  DEFAULT_INVESTIGATE,
  cardModel,
  findTopic,
  formatPercent,
  initialInvestigateState,
  landPhrase,
  parseInvestigateHash,
  rankRows,
  resolveTopicId,
  serializeInvestigateHash,
  significantArea,
  suggestedPlaces,
  topicRows,
  topicVariables,
  workedExample,
  type InvestigateState,
} from './model'

function variable(id: string, category = 'water', extra: Partial<VariableMeta> = {}): VariableMeta {
  return {
    id,
    label: id.replace(/_/g, ' '),
    category,
    product: 'TEST_PRODUCT',
    product_version: '1',
    doi: null,
    source_type: 'model',
    source_variable: id,
    display_unit: 'mm/month',
    slope_unit: 'mm/month per year',
    description: `Description of ${id}.`,
    caveats: [],
    core: false,
    increase_means: 'wetter',
    ...extra,
  }
}

function row(patch: Partial<ScreenerRow> & { variable: string }): ScreenerRow {
  return {
    valid_area_fraction: 1,
    sig_increase_area_fraction: 0,
    sig_decrease_area_fraction: 0,
    median_abs_std_change_decade: null,
    median_sen_slope_decade_sig: null,
    regional_contrast: null,
    n_cells_evaluated: 10,
    ...patch,
  }
}

const REGISTRY = [
  variable('air_temperature', 'temperature', { increase_means: 'warmer' }),
  variable('surface_skin_temperature', 'temperature'),
  variable('precipitation'),
  variable('root_zone_soil_moisture'),
  variable('surface_soil_moisture'),
  variable('evapotranspiration'),
  variable('specific_humidity', 'atmosphere', { increase_means: 'more humid' }),
]

describe('topicVariables', () => {
  it('builds the four fixed cards from ids that exist, in spec order', () => {
    const topics = topicVariables(REGISTRY)
    expect(topics.map((topic) => topic.id)).toEqual(['heat', 'rain', 'drought', 'moisture', 'all'])
    expect(topics[0].variableIds).toEqual(['air_temperature', 'surface_skin_temperature'])
    expect(topics[1].variableIds).toEqual(['precipitation'])
    expect(topics[2].variableIds).toEqual([
      'root_zone_soil_moisture',
      'surface_soil_moisture',
      'evapotranspiration',
    ])
    expect(topics[3].variableIds).toEqual(['specific_humidity'])
    expect(topics[4].variableIds).toEqual(REGISTRY.map((item) => item.id))
  })

  it('skips an id that index.json does not contain and hides an empty card', () => {
    const withoutSkin = REGISTRY.filter((item) => item.id !== 'surface_skin_temperature')
    const heat = topicVariables(withoutSkin).find((topic) => topic.id === 'heat')
    expect(heat?.variableIds).toEqual(['air_temperature'])

    const withoutRain = REGISTRY.filter((item) => item.id !== 'precipitation')
    expect(topicVariables(withoutRain).some((topic) => topic.id === 'rain')).toBe(false)
  })

  it('puts an unlisted variable under its category and under Show me everything', () => {
    const extended = [...REGISTRY, variable('relative_humidity', 'atmosphere', { increase_means: 'more humid' })]
    const topics = topicVariables(extended)
    const atmosphere = topics.find((topic) => topic.id === 'category-atmosphere')
    expect(atmosphere?.label).toBe('Atmosphere')
    expect(atmosphere?.variableIds).toEqual(['relative_humidity'])
    // The already-listed humidity variable stays under Air moisture only.
    expect(topics.find((topic) => topic.id === 'moisture')?.variableIds).toEqual(['specific_humidity'])
    expect(topics[topics.length - 1].id).toBe(ALL_TOPIC)
    expect(topics[topics.length - 1].variableIds).toContain('relative_humidity')
  })

  it('falls back to Show me everything for an unknown topic', () => {
    const topics = topicVariables(REGISTRY)
    expect(resolveTopicId('not-a-topic', topics)).toBe(ALL_TOPIC)
    expect(resolveTopicId(null, topics)).toBe(ALL_TOPIC)
    expect(findTopic(topics, 'heat').id).toBe('heat')
    expect(findTopic(topics, 'not-a-topic').id).toBe(ALL_TOPIC)
  })
})

describe('rankRows', () => {
  it('orders by increase + decrease, largest first, keeping ties stable', () => {
    const rows = [
      row({ variable: 'a', sig_increase_area_fraction: 0.1, sig_decrease_area_fraction: 0.0 }),
      row({ variable: 'b', sig_increase_area_fraction: 0.3, sig_decrease_area_fraction: 0.1 }),
      row({ variable: 'c', sig_increase_area_fraction: 0.2, sig_decrease_area_fraction: 0.2 }),
      row({ variable: 'd', sig_increase_area_fraction: 0.1, sig_decrease_area_fraction: 0.0 }),
    ]
    expect(rankRows(rows).map((entry) => entry.variable)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('puts rows without the two area fields last', () => {
    const rows = [
      row({ variable: 'missing', sig_increase_area_fraction: Number.NaN, sig_decrease_area_fraction: 0.2 }),
      row({ variable: 'zero' }),
      row({ variable: 'some', sig_increase_area_fraction: 0.05, sig_decrease_area_fraction: 0 }),
    ]
    expect(rankRows(rows).map((entry) => entry.variable)).toEqual(['some', 'zero', 'missing'])
    expect(significantArea(rows[0])).toBeNull()
  })

  it('filters a topic and keeps the ranking', () => {
    const rows = [
      row({ variable: 'air_temperature', sig_increase_area_fraction: 0.5, sig_decrease_area_fraction: 0 }),
      row({ variable: 'precipitation', sig_increase_area_fraction: 0.9, sig_decrease_area_fraction: 0 }),
      row({ variable: 'surface_skin_temperature', sig_increase_area_fraction: 0.2, sig_decrease_area_fraction: 0.1 }),
    ]
    const topics = topicVariables(REGISTRY)
    const heat = findTopic(topics, 'heat')
    expect(topicRows(rows, heat).map((entry) => entry.variable)).toEqual([
      'air_temperature',
      'surface_skin_temperature',
    ])
  })
})

describe('cardModel', () => {
  const land = landPhrase('country', 'Vietnam')

  it('builds the headline from the verdict and the row share', () => {
    const card = cardModel({
      variable: REGISTRY[0],
      row: row({
        variable: 'air_temperature',
        sig_increase_area_fraction: 0.6345,
        sig_decrease_area_fraction: 0.1671,
        median_sen_slope_decade_sig: 0.5,
        sig_trend_flagged_fraction: 0.1,
        witness_corroborated_fraction: 0.6,
        witness_contradicted_fraction: 0.1,
      }),
      land,
    })
    expect(land).toBe("Vietnam's land")
    expect(card.headline).toBe("Warmer over 63.4% of Vietnam's land, strong evidence")
    expect(card.verdict.label).toBe('Warmer, strong evidence')
    expect(card.share).toBeCloseTo(0.6345)
    expect(card.witnessNote).toBe('60% confirmed by a second NASA dataset')
    expect(card.cautions).toEqual([])
  })

  it('adds the contract caution lines above 0.2 and keeps the direction', () => {
    const card = cardModel({
      variable: REGISTRY[0],
      row: row({
        variable: 'air_temperature',
        sig_increase_area_fraction: 0.6345,
        sig_decrease_area_fraction: 0.1671,
        median_sen_slope_decade_sig: 0.5,
        sig_trend_flagged_fraction: 0.6683,
        witness_corroborated_fraction: 0.291,
        witness_contradicted_fraction: 0.1677,
      }),
      land,
    })
    expect(card.verdict.label).toBe('Read with caution')
    expect(card.headline).toBe("Warmer over 63.4% of Vietnam's land, read with caution")
    expect(card.cautions).toHaveLength(1)
    expect(card.cautions[0]).toMatch(/sudden shift|Sudden-shift/i)
    expect(card.cautions[0]).toMatch(/data discontinuity/i)
    expect(card.witnessNote).toBe('29% confirmed by a second NASA dataset')
    expect(card.notYetNote).toBeNull()
  })

  it('treats exactly 0.2 as not above the threshold', () => {
    const card = cardModel({
      variable: REGISTRY[0],
      row: row({
        variable: 'air_temperature',
        sig_increase_area_fraction: 0.5,
        sig_decrease_area_fraction: 0.1,
        sig_trend_flagged_fraction: 0.2,
        witness_contradicted_fraction: 0.2,
      }),
      land,
    })
    expect(card.cautions).toEqual([])
  })

  it('works without witness fields (a schema 1.2 file)', () => {
    const card = cardModel({
      variable: REGISTRY[0],
      row: row({
        variable: 'air_temperature',
        sig_increase_area_fraction: 0.5,
        sig_decrease_area_fraction: 0.0,
        median_sen_slope_decade_sig: 0.4,
        sig_trend_flagged_fraction: 0.3,
      }),
      land,
    })
    expect(card.witnessNote).toBeNull()
    expect(card.cautions).toHaveLength(1)
    expect(card.cautions[0]).toMatch(/Sudden-shift/i)
  })

  it('says a direction is not yet significant below 10% and never "no change"', () => {
    const card = cardModel({
      variable: REGISTRY[0],
      row: row({
        variable: 'air_temperature',
        sig_increase_area_fraction: 0.03,
        sig_decrease_area_fraction: 0,
        median_sen_slope_decade_sig: 0.4,
      }),
      land,
    })
    expect(card.verdict.label).toBe('A direction, not yet significant')
    expect(card.headline).toBe("A direction, not yet significant: warmer over 3.0% of Vietnam's land")
    expect(card.notYetNote).toBe(GLOSSARY.not_yet_significant.plain)
    expect(card.headline).not.toMatch(/no change/i)
  })

  it('does not invent a direction when the row has no significant area', () => {
    const card = cardModel({
      variable: REGISTRY[2],
      row: row({ variable: 'precipitation' }),
      land,
    })
    expect(card.headline).toBe("A direction, not yet significant across Vietnam's land")
    expect(card.notYetNote).toBeNull()
    expect(card.headline).not.toMatch(/no change/i)
  })

  it('does not add the not-yet sentence when the verdict is No clear trend', () => {
    const card = cardModel({
      variable: REGISTRY[0],
      row: row({
        variable: 'air_temperature',
        sig_increase_area_fraction: 0.04,
        sig_decrease_area_fraction: 0,
        median_sen_slope_decade_sig: 0,
      }),
      land,
    })
    expect(card.verdict.label).toBe('No clear trend')
    expect(card.notYetNote).toBeNull()
    expect(card.headline).toBe("No clear trend across Vietnam's land")
  })

  it('names the decreasing direction', () => {
    const card = cardModel({
      variable: REGISTRY[6],
      row: row({
        variable: 'specific_humidity',
        sig_increase_area_fraction: 0,
        sig_decrease_area_fraction: 0.4,
        median_sen_slope_decade_sig: -0.2,
      }),
      land,
    })
    expect(card.headline).toBe("Falling over 40.0% of Vietnam's land, strong evidence")
    expect(card.direction).toBe('decrease')
  })
})

describe('place wording', () => {
  it('adapts to the kind of place', () => {
    expect(landPhrase('global', 'the whole world')).toBe('global land')
    expect(landPhrase('country', 'Vietnam')).toBe("Vietnam's land")
    expect(landPhrase('region', 'Mekong basin (approx. box)')).toBe('the Mekong basin')
  })
})

describe('hash parse and serialize', () => {
  it('round-trips the documented link', () => {
    const state: InvestigateState = { place: 'country_704', topic: 'heat', windowId: '2001-2024' }
    const hash = serializeInvestigateHash(state)
    expect(hash).toBe('#/investigate?place=country_704&topic=heat&w=2001-2024')
    expect(parseInvestigateHash(hash)).toEqual(state)
  })

  it('ignores other pages and malformed query parts', () => {
    expect(parseInvestigateHash('#/region?v=air_temperature&w=2001-2024')).toEqual({})
    expect(parseInvestigateHash('')).toEqual({})
    expect(parseInvestigateHash('#/investigate?place=%20%20&topic=&w=')).toEqual({})
    const parsed = parseInvestigateHash('#/investigate?place=country_704&topic=heat&w=2001-2024&extra=1')
    expect(Object.keys(parsed).sort()).toEqual(['place', 'topic', 'windowId'])
    expect(parsed.windowId).toBe('2001-2024')
  })

  it('restores place and topic from the original URL, then the tab copy', () => {
    const hash = '#/investigate?w=2001-2024'
    const state = initialInvestigateState({
      hash,
      navHash: '#/investigate?place=country_704&topic=heat&w=2001-2024',
      stored: null,
      storedNavHash: null,
      defaultWindowId: '2001-2024',
    })
    expect(state).toEqual({ place: 'country_704', topic: 'heat', windowId: '2001-2024' })

    const stored = initialInvestigateState({
      hash,
      navHash: '#/investigate?place=country_704&topic=heat&w=2001-2024',
      stored: { place: 'country_004', topic: 'rain', windowId: '2013-2024' },
      storedNavHash: '#/investigate?place=country_704&topic=heat&w=2001-2024',
      defaultWindowId: '2001-2024',
    })
    // A consumed navigation URL must not override the visitor's later answers.
    expect(stored).toEqual({ place: 'country_004', topic: 'rain', windowId: '2001-2024' })
  })

  it('uses the defaults when nothing is present', () => {
    const state = initialInvestigateState({
      hash: '',
      navHash: null,
      stored: null,
      storedNavHash: null,
      defaultWindowId: '',
    })
    expect(state).toEqual(DEFAULT_INVESTIGATE)
  })
})

describe('workedExample', () => {
  const cases: DetectiveCase[] = [
    {
      id: 'case-01',
      title: 'Satellite rainfall is rising across China and Russia',
      region: { bbox: [0, 0, 0, 0], label: 'China and Russia' },
      window: '2001-2024',
      why_selected: '',
      evidence: [
        {
          variable: 'precipitation',
          product: 'GPM',
          method: '',
          sen_slope_decade: 0,
          slope_unit: '',
          p_value: 0,
          q_value: 0,
          valid_observations: 0,
          coverage_fraction: 1,
          trend_class: 1,
        },
      ],
      limitations: [],
    },
    {
      id: 'case-04',
      title: 'Vietnam is warming',
      region: { bbox: [0, 0, 0, 0], label: 'Vietnam' },
      window: '2001-2024',
      why_selected: '',
      evidence: [
        {
          variable: 'air_temperature',
          product: 'GLDAS',
          method: '',
          sen_slope_decade: 0,
          slope_unit: '',
          p_value: 0,
          q_value: 0,
          valid_observations: 0,
          coverage_fraction: 1,
          trend_class: 1,
        },
      ],
      limitations: [],
    },
  ]

  it('prefers the case that matches the place', () => {
    const match = workedExample(cases, {
      placeId: 'country_704',
      placeLabel: 'Vietnam',
      placeKind: 'country',
      variableIds: ['air_temperature', 'surface_skin_temperature'],
      windowId: '2001-2024',
    })
    expect(match?.id).toBe('case-04')
  })

  it('uses region.id when the published case carries one', () => {
    const withId = [
      {
        ...cases[1],
        region: { bbox: [0, 0, 0, 0] as [number, number, number, number], label: 'A label that does not match', id: 'country_704' },
      } as DetectiveCase,
      {
        ...cases[0],
        region: { bbox: [0, 0, 0, 0] as [number, number, number, number], label: 'Anywhere', id: 'global' },
      } as DetectiveCase,
    ]
    expect(
      workedExample(withId, {
        placeId: 'country_704',
        placeLabel: 'Nowhere',
        placeKind: 'country',
        variableIds: ['specific_humidity'],
        windowId: '2001-2024',
      })?.id,
    ).toBe('case-04')
    expect(
      workedExample(withId, {
        placeId: 'global',
        placeLabel: 'Global land',
        placeKind: 'global',
        variableIds: ['specific_humidity'],
        windowId: '2013-2024',
      })?.id,
    ).toBe('case-01')
  })

  it('falls back to a variable match when the place is unknown', () => {
    const match = workedExample(cases, {
      placeId: 'country_999',
      placeLabel: 'Nowhere',
      placeKind: 'country',
      variableIds: ['precipitation'],
      windowId: '2001-2024',
    })
    expect(match?.id).toBe('case-01')
  })

  it('returns null when nothing matches', () => {
    expect(
      workedExample(cases, {
        placeId: 'country_999',
        placeLabel: 'Nowhere',
        placeKind: 'country',
        variableIds: ['specific_humidity'],
        windowId: '2001-2024',
      }),
    ).toBeNull()
  })

  it('suggests the countries named by published cases, once each', () => {
    const countries = [
      { id: 'country_156', label: 'China' },
      { id: 'country_643', label: 'Russia' },
      { id: 'country_704', label: 'Vietnam' },
    ]
    expect(suggestedPlaces(countries, cases)).toEqual([
      { id: 'country_156', label: 'China' },
      { id: 'country_643', label: 'Russia' },
      { id: 'country_704', label: 'Vietnam' },
    ])
    expect(suggestedPlaces([], cases)).toEqual([])
  })
})

describe('percent formatting', () => {
  it('rounds for headlines and keeps one decimal when asked', () => {
    expect(formatPercent(0.6345)).toBe('63%')
    expect(formatPercent(0.635, 1)).toBe('63.5%')
    expect(formatPercent(null)).toBe('—')
  })
})

const DATA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public/data')
const dataAvailable =
  existsSync(resolve(DATA_ROOT, 'index.json')) &&
  existsSync(resolve(DATA_ROOT, 'screener/2001-2024/country_704.json')) &&
  existsSync(resolve(DATA_ROOT, 'cases.json'))

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(resolve(DATA_ROOT, relative), 'utf8')) as T
}

describe.skipIf(!dataAvailable)('the published Vietnam + Heat answer', () => {
  const index = readJson<DataIndex>('index.json')
  const screener = readJson<{ rows: ScreenerRow[] }>('screener/2001-2024/country_704.json')
  const cases = readJson<CasesFile>('cases.json')
  const topics = topicVariables(index.variables)
  const heat = findTopic(topics, 'heat')

  it('keeps the headline share equal to the screener row', () => {
    const airRow = screener.rows.find((entry) => entry.variable === 'air_temperature')
    const air = index.variables.find((entry) => entry.id === 'air_temperature')
    expect(airRow).toBeDefined()
    expect(air).toBeDefined()
    const card = cardModel({ variable: air as VariableMeta, row: airRow as ScreenerRow, land: "Vietnam's land" })
    expect(card.headline).toContain(`${((airRow as ScreenerRow).sig_increase_area_fraction * 100).toFixed(1)}%`)
    expect(card.share).toBeCloseTo((airRow as ScreenerRow).sig_increase_area_fraction, 10)
    expect(card.cautions.join(' ')).toMatch(/Sudden-shift/i)
  })

  it('ranks every published row by the same sum', () => {
    const cards = topicRows(screener.rows, heat).flatMap((entry) => {
      const meta = index.variables.find((item) => item.id === entry.variable)
      return meta ? [cardModel({ variable: meta, row: entry, land: "Vietnam's land" })] : []
    })
    expect(cards.length).toBeGreaterThan(0)
    for (let i = 1; i < cards.length; i += 1) {
      expect((cards[i - 1].rankedArea ?? 0) >= (cards[i].rankedArea ?? 0)).toBe(true)
    }
  })

  it('links Vietnam + Heat to the published Vietnam case', () => {
    const match = workedExample(cases.cases, {
      placeId: 'country_704',
      placeLabel: 'Vietnam',
      placeKind: 'country',
      variableIds: heat.variableIds,
      windowId: '2001-2024',
    })
    expect(match?.id).toBe('case-04')
  })
})
