import { describe, expect, it, vi } from 'vitest'
import type { Strings } from '../../i18n'
import { STRINGS as COACH } from './CoachMark'
import { STRINGS as LAYOUT } from '../Layout'
import { STRINGS as APP } from '../../App'
import { STRINGS as SELECT } from '../VariableSelect'
import { STRINGS as PLACE } from '../PlaceSearch'
import { STRINGS as GLOBE } from '../globe/EarthGlobe'
import { STRINGS as CHART_FRAME } from '../../charts/ChartFrame'
import { STRINGS as ANOMALY } from '../../charts/AnomalyTrendChart'
import { STRINGS as COMPARE } from '../../charts/ComparisonChart'
import { STRINGS as MONTHLY } from '../../charts/MonthlyValuesChart'
import { STRINGS as TRACES } from '../../charts/traces'

vi.mock('plotly.js-basic-dist-min', () => ({ default: {} }))
vi.mock('../../charts/plotly', () => ({ Plot: () => null }))

const TABLES: Record<string, Strings<Record<string, unknown>>> = {
  COACH, LAYOUT, APP, SELECT, PLACE, GLOBE, CHART_FRAME, ANOMALY, COMPARE, MONTHLY, TRACES,
}

// Vietnamese text that may equal the English text (names, abbreviations, units).
const SAME_ALLOWED = new Set<string>([])

function check(path: string, en: unknown, vi: unknown): void {
  expect(typeof vi, path).toBe(typeof en)
  if (typeof en === 'string') {
    expect(en.trim().length, `${path} en`).toBeGreaterThan(0)
    expect((vi as string).trim().length, `${path} vi`).toBeGreaterThan(0)
    if (!SAME_ALLOWED.has(path)) expect(vi, `${path} is untranslated`).not.toBe(en)
  } else if (typeof en === 'function') {
    expect(typeof vi, path).toBe('function')
  } else if (Array.isArray(en)) {
    expect(Array.isArray(vi), path).toBe(true)
    expect((vi as unknown[]).length, path).toBe(en.length)
    en.forEach((item, i) => check(`${path}[${i}]`, item, (vi as unknown[])[i]))
  } else if (en && typeof en === 'object') {
    expect(Object.keys(vi as object).sort(), path).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(en)) check(`${path}.${key}`, (en as Record<string, unknown>)[key], (vi as Record<string, unknown>)[key])
  }
}

describe('string tables', () => {
  for (const [name, table] of Object.entries(TABLES)) {
    it(`${name} has the same keys and types in English and Vietnamese`, () => {
      expect(Object.keys(table.vi).sort()).toEqual(Object.keys(table.en).sort())
      for (const key of Object.keys(table.en)) check(`${name}.${key}`, table.en[key], table.vi[key])
    })
  }
})
