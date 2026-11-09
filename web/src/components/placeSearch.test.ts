import { describe, expect, it } from 'vitest'
import { filterAndSortPlaces, normalizeSearch, type PlaceOption } from './PlaceSearch'

const options: PlaceOption[] = [
  { id: 'country_704', label: 'Việt Nam', kind: 'country', isoNumeric: '704', nCells: 30 },
  { id: 'country_862', label: 'Venezuela', kind: 'country', isoNumeric: '862' },
  { id: 'country_410', label: 'Republic of Korea', kind: 'country', isoNumeric: '410' },
  { id: 'country_710', label: 'South Africa', kind: 'country', isoNumeric: '710' },
  { id: 'mekong', label: 'Mekong basin (approx. box)', kind: 'box' },
  { id: 'southeast_asia', label: 'Southeast Asia (approx. box)', kind: 'box' },
]

describe('normalizeSearch', () => {
  it('lower-cases and removes Vietnamese accents', () => {
    expect(normalizeSearch('Việt Nam')).toBe('viet nam')
    expect(normalizeSearch('Đà Nẵng')).toBe('da nang')
    expect(normalizeSearch('  MÉXICO  ')).toBe('mexico')
  })
})

describe('filterAndSortPlaces', () => {
  it('finds countries without accents and ignores case', () => {
    expect(filterAndSortPlaces(options, 'viet').map((option) => option.id)).toEqual([
      'country_704',
    ])
    expect(filterAndSortPlaces(options, 'VIỆT').map((option) => option.id)).toEqual([
      'country_704',
    ])
    expect(filterAndSortPlaces(options, 'mekong').map((option) => option.id)).toEqual([
      'mekong',
    ])
  })

  it('ranks exact and prefix matches before substring matches', () => {
    const ranked = filterAndSortPlaces(
      [
        { id: 'country_1', label: 'Republic of Vietnam', kind: 'country' },
        { id: 'country_2', label: 'South Vietnam', kind: 'country' },
        { id: 'country_3', label: 'Vietnam', kind: 'country' },
      ],
      'viet',
    )
    expect(ranked.map((option) => option.id)).toEqual([
      'country_3',
      'country_1',
      'country_2',
    ])
  })

  it('puts recent picks first when the query is empty', () => {
    const ranked = filterAndSortPlaces(options, '', ['country_710', 'country_704'])
    expect(ranked.slice(0, 2).map((option) => option.id)).toEqual([
      'country_710',
      'country_704',
    ])
    expect(ranked[2].label).toBe('Mekong basin (approx. box)')
  })

  it('matches ISO numeric ids and returns nothing for an unknown term', () => {
    expect(filterAndSortPlaces(options, '704').map((option) => option.id)).toEqual([
      'country_704',
    ])
    expect(filterAndSortPlaces(options, 'atlantis')).toEqual([])
  })

  it('matches every term in a multi-word query', () => {
    expect(filterAndSortPlaces(options, 'south africa').map((option) => option.id)).toEqual([
      'country_710',
    ])
    expect(filterAndSortPlaces(options, 'south korea')).toEqual([])
  })

  it('uses recent picks as a tiebreak for non-empty queries', () => {
    const ranked = filterAndSortPlaces(options, 'a', ['southeast_asia'])
    expect(ranked[0].id).toBe('southeast_asia')
  })
})
