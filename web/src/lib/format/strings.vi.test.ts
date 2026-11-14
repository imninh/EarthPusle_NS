// Vietnamese forms of the shared helpers: glossary, verdict words, unit words, and the
// Vietnamese case titles and variable descriptions for the published data files.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  INSUFFICIENT_DATA,
  TREND_DECREASE,
  TREND_INCREASE,
  TREND_NOT_SIGNIFICANT,
} from '../../data/contract'
import { CASE_TITLE_VI, VARIABLE_DESCRIPTION_VI, caseTitle, variableDescription } from '../../i18n/terms'
import { GLOSSARY, GLOSSARY_ORDER, glossaryEntry, type TermId } from './glossary'
import { GLOSSARY_VI, UNIT_WORDS_VI, VERDICT_LABELS_VI } from './strings.vi'
import { formatUnit, formatUnitIn, localizeUnitWords } from './units'
import { VERDICT_LABELS, classifyVerdict, plainVerdict, verdictKindOfLabel } from './verdict'

const DATA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public/data')

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(resolve(DATA_ROOT, relative), 'utf8')) as T
}

const DIACRITIC = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i

describe('Vietnamese glossary', () => {
  const ids = Object.keys(GLOSSARY) as TermId[]

  it('has an entry for every term id, and the Method order lists the same ids', () => {
    expect(Object.keys(GLOSSARY_VI).sort()).toEqual([...ids].sort())
    for (const id of GLOSSARY_ORDER) expect(GLOSSARY_VI[id], id).toBeDefined()
  })

  it('has a non-empty term, plain sentence and technical note for every term', () => {
    for (const id of ids) {
      const entry = GLOSSARY_VI[id]
      expect(entry.term.trim(), `${id} term`).not.toBe('')
      expect(entry.plain.trim(), `${id} plain`).not.toBe('')
      expect(entry.technical.trim(), `${id} technical`).not.toBe('')
      expect(entry.plain, `${id} plain is Vietnamese`).toMatch(DIACRITIC)
      expect(entry.plain, `${id} plain has no em dash`).not.toContain('—')
      expect(entry.technical, `${id} technical has no em dash`).not.toContain('—')
    }
  })

  it('glossaryEntry returns English by default and Vietnamese on request', () => {
    expect(glossaryEntry('significant')).toBe(GLOSSARY.significant)
    expect(glossaryEntry('significant', 'en')).toBe(GLOSSARY.significant)
    expect(glossaryEntry('significant', 'vi')).toBe(GLOSSARY_VI.significant)
  })

  it('keeps method names in their original form', () => {
    expect(GLOSSARY_VI.significant.technical).toContain('Hamed–Rao')
    expect(GLOSSARY_VI.significant.technical).toContain('Mann–Kendall')
    expect(GLOSSARY_VI.significant.technical).toContain('Benjamini–Hochberg')
    expect(GLOSSARY_VI.sudden_shift.technical).toContain('Pettitt')
    expect(GLOSSARY_VI.rate_of_change.technical).toContain("Sen's slope")
  })

  it('names "not significant" with the shared term', () => {
    expect(GLOSSARY_VI.not_yet_significant.term).toBe('Chưa có ý nghĩa thống kê')
  })
})

describe('Vietnamese verdict words', () => {
  it('has a Vietnamese form for every verdict label', () => {
    expect(Object.keys(VERDICT_LABELS_VI).sort()).toEqual(Object.keys(VERDICT_LABELS).sort())
    for (const [key, label] of Object.entries(VERDICT_LABELS_VI)) {
      expect(label.trim(), key).not.toBe('')
    }
  })

  it('names the stamp ĐỌC THẬN TRỌNG for caution', () => {
    expect(plainVerdict({ trendClass: TREND_INCREASE, flagged: true }, 'vi')).toEqual({
      label: 'ĐỌC THẬN TRỌNG',
      tone: 'warn',
    })
  })

  it('uses the Investigate wording for the other verdicts', () => {
    expect(plainVerdict({ trendClass: TREND_INCREASE, increaseMeans: 'warmer' }, 'vi').label).toBe(
      'Ấm lên, bằng chứng mạnh',
    )
    expect(plainVerdict({ trendClass: TREND_DECREASE, increaseMeans: 'wetter' }, 'vi').label).toBe(
      'Khô hơn, bằng chứng mạnh',
    )
    expect(plainVerdict({ trendClass: TREND_INCREASE }, 'vi').label).toBe('Tăng, bằng chứng mạnh')
    expect(plainVerdict({ trendClass: TREND_DECREASE }, 'vi').label).toBe('Giảm, bằng chứng mạnh')
    expect(plainVerdict({ trendClass: TREND_NOT_SIGNIFICANT, slope: 0.1 }, 'vi').label).toBe(
      'Có một hướng thay đổi, chưa có ý nghĩa thống kê',
    )
    expect(plainVerdict({ trendClass: TREND_NOT_SIGNIFICANT, slope: 0 }, 'vi').label).toBe(
      'Chưa thấy xu hướng rõ ràng',
    )
    expect(plainVerdict({ trendClass: INSUFFICIENT_DATA }, 'vi').label).toBe('Chưa đủ dữ liệu')
  })

  it('keeps the tone and kind the same in both languages', () => {
    const inputs = [
      { trendClass: TREND_INCREASE, increaseMeans: 'warmer' },
      { trendClass: TREND_DECREASE },
      { trendClass: TREND_NOT_SIGNIFICANT, slope: 0.1 },
      { trendClass: TREND_NOT_SIGNIFICANT, slope: 0 },
      { trendClass: TREND_INCREASE, flagged: true },
      { trendClass: INSUFFICIENT_DATA },
    ]
    for (const input of inputs) {
      const en = plainVerdict(input)
      const vi = plainVerdict(input, 'vi')
      expect(vi.tone).toBe(en.tone)
      // A label cannot tell a strong increase from a strong decrease in Vietnamese; the stamp
      // tone does not need to, so both count as 'strong'. classifyVerdict keeps them apart.
      const group = (kind: string) => (kind.startsWith('strong') ? 'strong' : kind)
      expect(group(verdictKindOfLabel(vi.label))).toBe(group(verdictKindOfLabel(en.label)))
      expect(group(verdictKindOfLabel(vi.label))).toBe(group(classifyVerdict(input).kind))
    }
  })
})

describe('Vietnamese unit words', () => {
  it('translates the rate words and keeps every symbol', () => {
    expect(localizeUnitWords('°C per decade', 'vi')).toBe('°C mỗi thập kỷ')
    expect(localizeUnitWords('kg/m² per year', 'vi')).toBe('kg/m² mỗi năm')
    expect(localizeUnitWords('mm per month', 'vi')).toBe('mm mỗi tháng')
    expect(localizeUnitWords('g/kg per decade', 'vi')).toBe('g/kg mỗi thập kỷ')
    expect(localizeUnitWords('hPa', 'vi')).toBe('hPa')
    expect(localizeUnitWords('DU', 'vi')).toBe('DU')
    expect(UNIT_WORDS_VI.perDecade).toBe('mỗi thập kỷ')
  })

  it('leaves English unchanged', () => {
    expect(localizeUnitWords('°C per decade', 'en')).toBe('°C per decade')
    expect(formatUnitIn('degC per decade', 'en')).toBe(formatUnit('degC per decade'))
    expect(formatUnitIn('1', 'en')).toBe('fraction (0-1)')
  })

  it('formats a raw unit and then translates its words', () => {
    expect(formatUnitIn('degC per decade', 'vi')).toBe('°C mỗi thập kỷ')
    expect(formatUnitIn('kg m-2 per decade', 'vi')).toBe('kg/m² mỗi thập kỷ')
    expect(formatUnitIn('1', 'vi')).toBe('tỷ lệ (0-1)')
  })
})

describe('Vietnamese case titles and variable descriptions for the published data', () => {
  const cases = readJson<{ cases: { id: string; title: string }[] }>('cases.json').cases
  const variables = readJson<{ variables: { id: string; description?: string }[] }>('index.json').variables

  it('has a Vietnamese title for every published case id', () => {
    for (const item of cases) {
      const title = CASE_TITLE_VI[item.id]
      expect(title, item.id).toBeTruthy()
      expect(title, item.id).toMatch(DIACRITIC)
      expect(title, item.id).not.toContain('—')
      expect(caseTitle(item, 'vi'), item.id).toBe(title)
      expect(caseTitle(item, 'en'), item.id).toBe(item.title)
    }
  })

  it('falls back to the English title for an unknown case', () => {
    expect(caseTitle({ id: 'case-99', title: 'A new case' }, 'vi')).toBe('A new case')
  })

  it('has a Vietnamese description for every published variable id', () => {
    for (const variable of variables) {
      const text = VARIABLE_DESCRIPTION_VI[variable.id]
      expect(text, variable.id).toBeTruthy()
      expect(variableDescription(variable, 'vi'), variable.id).toBe(text)
      expect(variableDescription(variable, 'en'), variable.id).toBe(variable.description ?? '')
    }
  })

  it('falls back to the English description for an unknown variable', () => {
    expect(variableDescription({ id: 'new_variable', description: 'English text' }, 'vi')).toBe('English text')
  })
})
