import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface PublishedCase {
  id: string
  title: string
  kind?: 'finding' | 'caution'
  window: string
  summary?: string
  region: {
    bbox: [number, number, number, number]
    label: string
    id?: string
  }
  evidence: { variable: string }[]
}

interface CasesFile {
  cases: PublishedCase[]
}

const casesPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'data',
  'cases.json',
)
let cached: PublishedCase[] | null = null

export function publishedCases(): PublishedCase[] {
  if (cached == null) {
    const file = JSON.parse(readFileSync(casesPath, 'utf8')) as CasesFile
    cached = file.cases
  }
  return cached
}

/**
 * Resolve a case by title or by kind + region label. Case ids follow rank order
 * and change whenever selection changes, so tests must not use them as lookup keys.
 */
export function findCase(description: string, match: (item: PublishedCase) => boolean): PublishedCase {
  const matches = publishedCases().filter(match)
  if (matches.length !== 1) {
    const found = matches.map((item) => `${item.id} "${item.title}"`).join(', ') || 'none'
    throw new Error(
      `expected exactly one ${description} in cases.json; found ${matches.length}: ${found}`,
    )
  }
  return matches[0]
}

export function vietnamCase(): PublishedCase {
  return findCase(
    'Vietnam caution case',
    (item) =>
      /Vietnam is warming/i.test(item.title) ||
      (item.kind === 'caution' && /vietnam/i.test(item.region.label)),
  )
}

export function globalCautionCase(): PublishedCase {
  return findCase(
    'global caution case',
    (item) => item.kind === 'caution' && /global/i.test(item.region.label),
  )
}
