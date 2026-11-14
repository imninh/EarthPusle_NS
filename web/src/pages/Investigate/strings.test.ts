import { describe, expect, it } from 'vitest'
import type { VariableMeta } from '../../data/types'
import { cardModel, landPhrase } from './model'
import { STRINGS } from './strings'

function typeOf(value: unknown): string {
  return typeof value
}

function check(en: unknown, vi: unknown, path: string): void {
  expect(typeOf(vi), path).toBe(typeOf(en))
  if (typeof en === 'string') {
    expect(en.length, `${path} en`).toBeGreaterThan(0)
    expect((vi as string).length, `${path} vi`).toBeGreaterThan(0)
  } else if (typeof en === 'object' && en !== null) {
    expect(Object.keys(vi as object).sort(), path).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(en)) {
      check((en as Record<string, unknown>)[key], (vi as Record<string, unknown>)[key], `${path}.${key}`)
    }
  }
}

describe('Investigate strings', () => {
  it('has every key in both languages with the same type and a non-empty value', () => {
    expect(Object.keys(STRINGS.vi).sort()).toEqual(Object.keys(STRINGS.en).sort())
    for (const key of Object.keys(STRINGS.en)) {
      check(
        (STRINGS.en as Record<string, unknown>)[key],
        (STRINGS.vi as Record<string, unknown>)[key],
        key,
      )
    }
  })

  it('words the headline in Vietnamese with the same number', () => {
    const variable: VariableMeta = {
      id: 'air_temperature',
      label: 'air temperature',
      category: 'temperature',
      product: 'TEST_PRODUCT',
      product_version: '1',
      doi: null,
      source_type: 'model',
      source_variable: 'air_temperature',
      display_unit: 'K',
      slope_unit: 'K/decade',
      description: '',
      caveats: [],
      core: true,
      increase_means: 'warmer',
    }
    const row = {
      valid_area_fraction: 1,
      variable: 'air_temperature',
      sig_increase_area_fraction: 0.6345,
      sig_decrease_area_fraction: 0.1671,
      median_abs_std_change_decade: null,
      median_sen_slope_decade_sig: 0.5,
      regional_contrast: null,
      n_cells_evaluated: 10,
    }
    const en = cardModel({ variable, row, land: landPhrase('country', 'Vietnam') })
    const vi = cardModel({ variable, row, land: landPhrase('country', 'Vietnam', 'vi') }, 'vi')
    expect(en.headline).toBe("Warmer over 63.4% of Vietnam's land, strong evidence")
    expect(vi.headline).not.toBe(en.headline)
    expect(vi.headline).toContain('63.4%')
  })
})
