// Acceptance guard for P19 T3: the rendered text of Home, Screener, Story and
// Method must never show a raw contract unit. The pages are React components
// with async loaders; this test drives the same pure formatters they render, on
// the real published index/screener/cases files, and greps the result.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CasesFile, DataIndex, ScreenerFile } from '../../data/types'
import { METHOD_LIMITATIONS, METHOD_STEPS } from '../../pages/Method/content'
import { buildViewRows } from '../../pages/Screener/metrics'
import { buildHomeInsights } from '../../pages/Home/insights'
import { GLOSSARY, GLOSSARY_ORDER, formatUnit } from './index'

const DATA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public/data')

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(resolve(DATA_ROOT, relative), 'utf8')) as T
}

const RAW_UNIT = /degC|kg m-2|g kg-1/

const dataAvailable =
  existsSync(resolve(DATA_ROOT, 'index.json')) &&
  existsSync(resolve(DATA_ROOT, 'screener/2001-2024/global.json')) &&
  existsSync(resolve(DATA_ROOT, 'cases.json'))

describe.skipIf(!dataAvailable)('plain-language pages on the published data', () => {
  const index = readJson<DataIndex>('index.json')
  const screener = readJson<ScreenerFile>('screener/2001-2024/global.json')
  const cases = readJson<CasesFile>('cases.json')
  const rows = buildViewRows(index.variables, screener.rows)

  it('formats every registry unit and slope unit', () => {
    for (const variable of index.variables) {
      expect(formatUnit(variable.display_unit), variable.id).not.toMatch(RAW_UNIT)
      expect(formatUnit(variable.slope_unit), variable.id).not.toMatch(RAW_UNIT)
    }
  })

  it('shows no raw unit on the Screener', () => {
    const text = [
      'Variable',
      'Sudden shift',
      'Map',
      ...rows.flatMap((row) => [
        row.label,
        row.description,
        row.category,
        row.sourceBadge,
        formatUnit(row.unit),
        row.increaseMeans,
      ]),
      ...Object.values(GLOSSARY).flatMap((entry) => [entry.term, entry.plain, entry.technical]),
    ].join(' ')
    expect(text).not.toMatch(RAW_UNIT)
    // The registry description must actually reach the row model.
    expect(rows.every((row) => row.description.length > 0)).toBe(true)
  })

  it('shows no raw unit on Home', () => {
    const insights = buildHomeInsights(
      index.variables,
      screener.rows,
      '2001-01',
      '2024-12',
      cases.cases,
    )
    const text = [
      ...index.variables.flatMap((variable) => [variable.label, variable.description, variable.increase_means]),
      ...insights.flatMap((insight) => [insight.kicker, insight.value, insight.unit, insight.title, insight.detail]),
    ].join(' ')
    expect(text).not.toMatch(RAW_UNIT)
  })

  it('keeps the Home warming card equal to the published screener row', () => {
    const insights = buildHomeInsights(index.variables, screener.rows, '2001-01', '2024-12', cases.cases)
    const warming = insights.find((insight) => insight.id === 'warming')
    const row = screener.rows.find((entry) => entry.variable === 'air_temperature')
    expect(warming).toBeDefined()
    expect(row).toBeDefined()
    expect(warming?.value).toBe(`${(row!.sig_increase_area_fraction * 100).toFixed(1)}%`)
  })

  it('shows no raw unit on a Story case', () => {
    const text = cases.cases
      .flatMap((item) => [
        item.title,
        formatUnit(item.summary?.trim() || item.why_selected),
        formatUnit(item.details ?? ''),
        ...item.limitations.map(formatUnit),
        ...item.evidence.flatMap((evidence) => [
          formatUnit(evidence.slope_unit),
          formatUnit(evidence.method),
          ...(evidence.witness
            ? [formatUnit(evidence.witness.slope_unit), evidence.witness.product, evidence.witness.variable]
            : []),
        ]),
      ])
      .join(' ')
    expect(text).not.toMatch(RAW_UNIT)
    expect(cases.selection_method.length).toBeGreaterThan(0)
  })

  it('shows no raw unit on Method and renders every glossary term', () => {
    const productUnits = index.variables.map((variable) => formatUnit(variable.display_unit))
    const text = [
      ...METHOD_STEPS.flatMap((step) => [step.title, step.technical, step.body, step.why]),
      ...METHOD_LIMITATIONS,
      ...productUnits,
      ...GLOSSARY_ORDER.flatMap((id) => [GLOSSARY[id].term, GLOSSARY[id].plain, GLOSSARY[id].technical]),
    ].join(' ')
    expect(text).not.toMatch(RAW_UNIT)
    expect(GLOSSARY_ORDER.length).toBeGreaterThanOrEqual(10)
  })
})
