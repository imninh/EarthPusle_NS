// Pure helpers for the guided investigation page (P20).
// Every displayed number is read from a published screener row; this module only
// groups, ranks and words the rows. No statistics are computed here.
import {
  TREND_DECREASE,
  TREND_INCREASE,
  TREND_NOT_SIGNIFICANT,
  WITNESS_CONTRADICTED,
} from '../../data/contract'
import type { DetectiveCase, ScreenerRow, VariableMeta } from '../../data/types'
import { GLOSSARY, VERDICT_LABELS, plainVerdict, type PlainVerdict } from '../../lib/format'
import { pick, type Lang } from '../../i18n'
import { variableLabel } from '../../i18n/terms'
import { STRINGS, type FixedTopicId, type VerdictKind } from './strings'

export type { VerdictKind } from './strings'

/** Place id used for "The whole world (land)". */
export const GLOBAL_PLACE = 'global'
/** Topic id for the card that lists every variable. */
export const ALL_TOPIC = 'all'
/** The long window is the default answer, as on Home. */
export const DEFAULT_WINDOW_ID = '2001-2024'
/** Below this share of the evaluated land a direction is "not yet significant" (display rule). */
export const NOT_YET_BELOW = 0.1
/** A flagged or contradicted share above this fraction adds a caution line (spec / contract §12–§13). */
export const CAUTION_ABOVE = 0.2

export interface InvestigateState {
  /** `global` or a country/region id such as `country_704`. */
  place: string
  /** A topic id from `topicVariables`, or `all`. */
  topic: string
  /** A published window id, e.g. `2001-2024`. */
  windowId: string
}

export const DEFAULT_INVESTIGATE: InvestigateState = {
  place: GLOBAL_PLACE,
  topic: ALL_TOPIC,
  windowId: DEFAULT_WINDOW_ID,
}

export interface TopicDefinition {
  id: string
  label: string
  /** One plain line under the card title. */
  blurb: string
  variableIds: string[]
}

interface FixedTopic {
  id: string
  label: string
  blurb: string
  variables: readonly string[]
}

/**
 * The fixed question→variable mapping from the P20 spec. This is the only place
 * that decides which variables a "Heat" or "Air moisture" card shows.
 */
export const FIXED_TOPICS: readonly FixedTopic[] = [
  {
    id: 'heat',
    label: 'Heat',
    blurb: 'How warm the air and the land surface are.',
    variables: ['air_temperature', 'surface_skin_temperature'],
  },
  {
    id: 'rain',
    label: 'Rain',
    blurb: 'How much rain and snow reaches the ground.',
    variables: ['precipitation'],
  },
  {
    id: 'drought',
    label: 'Drought and soil water',
    blurb: 'Water stored in the soil, and how much evaporates.',
    variables: ['root_zone_soil_moisture', 'surface_soil_moisture', 'evapotranspiration'],
  },
  {
    id: 'moisture',
    label: 'Air moisture',
    blurb: 'How much water vapour the near-surface air carries.',
    variables: ['specific_humidity'],
  },
]

/** Category label for a "card named after its category" (P23 may add variables). */
function categoryTopic(category: string, lang: Lang): { id: string; label: string } {
  const slug = category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const label = pick(STRINGS, lang).categoryLabel(category)
  return { id: `category-${slug || 'other'}`, label }
}

/**
 * Build the question cards from the variables that actually exist in `index.json`.
 *
 * - Fixed cards keep their spec order; ids missing from the index are skipped.
 * - A fixed card with no remaining variable is hidden (never an empty card).
 * - A variable the fixed table does not list is shown under a card named after
 *   its `category`, and under "Show me everything".
 */
export function topicVariables(variables: readonly VariableMeta[], lang: Lang = 'en'): TopicDefinition[] {
  const t = pick(STRINGS, lang)
  const present = new Set(variables.map((variable) => variable.id))
  const topics: TopicDefinition[] = []
  const listed = new Set<string>()

  for (const fixed of FIXED_TOPICS) {
    const ids = fixed.variables.filter((id) => present.has(id) && !listed.has(id))
    ids.forEach((id) => listed.add(id))
    if (ids.length === 0) continue
    const words = t.topics[fixed.id as FixedTopicId] ?? { label: fixed.label, blurb: fixed.blurb }
    topics.push({ id: fixed.id, label: words.label, blurb: words.blurb, variableIds: ids })
  }

  const categories = new Map<string, string[]>()
  for (const variable of variables) {
    if (listed.has(variable.id)) continue
    const key = variable.category ?? ''
    const bucket = categories.get(key)
    if (bucket) bucket.push(variable.id)
    else categories.set(key, [variable.id])
  }
  for (const [category, ids] of categories) {
    const { id, label } = categoryTopic(category, lang)
    topics.push({
      id,
      label,
      blurb: t.categoryBlurb(label),
      variableIds: ids,
    })
  }

  topics.push({
    id: ALL_TOPIC,
    label: t.topics.all.label,
    blurb: t.topics.all.blurb,
    variableIds: variables.map((variable) => variable.id),
  })
  return topics
}

/** Fall back to the complete list when a link names a topic this export does not have. */
export function resolveTopicId(requested: string | null | undefined, topics: readonly TopicDefinition[]): string {
  if (requested && topics.some((topic) => topic.id === requested)) return requested
  return ALL_TOPIC
}

export function findTopic(topics: readonly TopicDefinition[], requested: string | null | undefined): TopicDefinition {
  const id = resolveTopicId(requested, topics)
  return topics.find((topic) => topic.id === id) ?? topics[topics.length - 1]
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Significant area of a row (`increase + decrease`); null when the row lacks a side. */
export function significantArea(row: ScreenerRow): number | null {
  const increase = finiteOrNull(row.sig_increase_area_fraction)
  const decrease = finiteOrNull(row.sig_decrease_area_fraction)
  if (increase == null || decrease == null) return null
  return increase + decrease
}

/**
 * Largest significant area first. Ties keep the registry order so the same file
 * always produces the same list; rows without the two area fields go last.
 */
export function rankRows(rows: readonly ScreenerRow[]): ScreenerRow[] {
  return rows
    .map((row, index) => ({ row, index, area: significantArea(row) }))
    .sort((a, b) => {
      if (a.area == null && b.area == null) return a.index - b.index
      if (a.area == null) return 1
      if (b.area == null) return -1
      if (a.area !== b.area) return b.area - a.area
      return a.index - b.index
    })
    .map((entry) => entry.row)
}

/** Rows of one topic, ranked. Variables absent from the index are ignored by the page. */
export function topicRows(rows: readonly ScreenerRow[], topic: TopicDefinition): ScreenerRow[] {
  const wanted = new Set(topic.variableIds)
  return rankRows(rows.filter((row) => wanted.has(row.variable)))
}

export type PlaceKind = 'global' | 'country' | 'region'

/** "global land", "Vietnam's land", "the Mekong basin". */
export function landPhrase(kind: PlaceKind, label: string, lang: Lang = 'en'): string {
  const t = pick(STRINGS, lang)
  if (kind === 'global') return t.landGlobal
  if (kind === 'country') return t.landCountry(label)
  const plain = label.replace(/\s*\(approx\. box\)$/i, '')
  return t.landRegion(plain)
}

/** Percent, whole by default, e.g. 0.6345 → "63%"; digits = 1 matches the Screener ("63.5%"). Null is an em dash. */
export function formatPercent(fraction: number | null, digits = 0): string {
  if (fraction == null || !Number.isFinite(fraction)) return '—'
  return `${(fraction * 100).toFixed(digits)}%`
}

export interface CardInput {
  variable: VariableMeta
  row: ScreenerRow
  /** "global land", "Vietnam's land", "the Amazon basin". */
  land: string
}

export interface CardModel {
  variableId: string
  label: string
  description: string
  category: string
  unit: string
  increaseMeans: string
  row: ScreenerRow
  /** Sum of the two significant-area fractions (null if a side is missing). */
  rankedArea: number | null
  sigIncrease: number | null
  sigDecrease: number | null
  /** Dominant significant-area fraction; 0 when nothing in the row is significant. */
  share: number
  direction: 'increase' | 'decrease' | 'none'
  verdict: PlainVerdict
  /** Which of the six verdicts this is, whatever the language of `verdict.label`. */
  verdictKind: VerdictKind
  /** One sentence built from `plainVerdict` and the row's dominant area share. */
  headline: string
  /** Contract wording about a data discontinuity or a disagreeing witness, when present. */
  cautions: string[]
  /** "x% confirmed by a second NASA dataset" when the export has witness fields. */
  witnessNote: string | null
  /** The shared "not yet significant" sentence when the significant share is below 10%. */
  notYetNote: string | null
}

function directionOf(row: ScreenerRow): 'increase' | 'decrease' | 'none' {
  const increase = finiteOrNull(row.sig_increase_area_fraction) ?? 0
  const decrease = finiteOrNull(row.sig_decrease_area_fraction) ?? 0
  if (increase === 0 && decrease === 0) return 'none'
  if (increase === decrease) {
    const slope = finiteOrNull(row.median_sen_slope_decade_sig)
    return slope != null && slope < 0 ? 'decrease' : 'increase'
  }
  return increase > decrease ? 'increase' : 'decrease'
}

/**
 * One answer card. The headline follows the shared verdict vocabulary:
 * "Warmer over 63.5% of Vietnam's land, strong evidence"; a share below 10% is
 * "A direction, not yet significant" (never "no change"); a flagged or
 * contradicted row is "Read with caution" and keeps its direction.
 */
export function cardModel({ variable, row, land }: CardInput, lang: Lang = 'en'): CardModel {
  const t = pick(STRINGS, lang)
  const increase = finiteOrNull(row.sig_increase_area_fraction)
  const decrease = finiteOrNull(row.sig_decrease_area_fraction)
  const rankedArea = significantArea(row)
  const direction = directionOf(row)
  const share = Math.max(increase ?? 0, decrease ?? 0)
  const slope = finiteOrNull(row.median_sen_slope_decade_sig)
  const broad = rankedArea != null && rankedArea >= NOT_YET_BELOW
  const significant = broad && direction !== 'none'

  const flagged = significant && (finiteOrNull(row.sig_trend_flagged_fraction) ?? 0) > CAUTION_ABOVE
  const contradicted = significant && (finiteOrNull(row.witness_contradicted_fraction) ?? 0) > CAUTION_ABOVE

  const trendClass = significant
    ? direction === 'increase'
      ? TREND_INCREASE
      : TREND_DECREASE
    : TREND_NOT_SIGNIFICANT
  const englishVerdict = plainVerdict({
    trendClass,
    flagged,
    witnessCode: contradicted ? WITNESS_CONTRADICTED : null,
    increaseMeans: variable.increase_means,
    slope,
  })
  const verdictKind = classifyVerdict(englishVerdict.label)
  const dirPhrase = t.dirPhrase(variable.increase_means ?? '', trendClass === TREND_DECREASE ? 'decrease' : 'increase')
  // English keeps the shared verdict words; other languages are worded from the kind.
  const verdict: PlainVerdict =
    lang === 'en'
      ? englishVerdict
      : { label: t.verdictLabel(verdictKind, dirPhrase), tone: englishVerdict.tone }

  // The direction word comes from the same vocabulary, even when the row is below
  // the "broad enough" threshold and the verdict is "not yet significant".
  const wordClass =
    direction === 'increase' ? TREND_INCREASE : direction === 'decrease' ? TREND_DECREASE : TREND_NOT_SIGNIFICANT
  const directionWord =
    lang === 'en'
      ? plainVerdict({ trendClass: wordClass, increaseMeans: variable.increase_means }).label.replace(
          /,\s*strong evidence$/,
          '',
        )
      : capitalise(t.dirPhrase(variable.increase_means ?? '', direction === 'decrease' ? 'decrease' : 'increase'))
  const percent = formatPercent(share, 1)

  let headline: string
  if (significant) {
    headline =
      verdictKind === 'caution'
        ? t.headlineCaution(directionWord, percent, land)
        : t.headlineStrong(directionWord, percent, land)
  } else if (share > 0 && verdictKind !== 'noClear' && direction !== 'none') {
    headline = t.headlineNotYet(verdict.label, directionWord.toLowerCase(), percent, land)
  } else {
    headline = t.headlineNone(verdict.label, land)
  }

  const cautions: string[] = []
  const flaggedShare = finiteOrNull(row.sig_trend_flagged_fraction)
  const contradictedShare = finiteOrNull(row.witness_contradicted_fraction)
  if (flaggedShare != null && flaggedShare > CAUTION_ABOVE) {
    cautions.push(t.cautionFlagged(formatPercent(flaggedShare)))
  }
  if (contradictedShare != null && contradictedShare > CAUTION_ABOVE) {
    cautions.push(t.cautionContradicted(formatPercent(contradictedShare)))
  }

  const corroborated = finiteOrNull(row.witness_corroborated_fraction)
  const witnessNote = corroborated == null ? null : t.witnessNote(formatPercent(corroborated))

  const showsDirection = slope != null || direction !== 'none'
  const notYetNote =
    (rankedArea ?? 0) < NOT_YET_BELOW && showsDirection && verdictKind !== 'noClear'
      ? lang === 'en'
        ? GLOSSARY.not_yet_significant.plain
        : t.notYetNote
      : null

  return {
    variableId: variable.id,
    label: variableLabel(variable, lang),
    description: variable.description,
    category: variable.category,
    unit: variable.display_unit,
    increaseMeans: variable.increase_means,
    row,
    rankedArea,
    sigIncrease: increase,
    sigDecrease: decrease,
    share,
    direction,
    verdict,
    verdictKind,
    headline,
    cautions,
    witnessNote,
    notYetNote,
  }
}

function capitalise(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1)
}

/** Map the shared English verdict label to its kind (the label is the only thing plainVerdict returns). */
function classifyVerdict(label: string): VerdictKind {
  if (label === VERDICT_LABELS.caution) return 'caution'
  if (label === VERDICT_LABELS.falling) return 'strongDecrease'
  if (label === VERDICT_LABELS.notYet) return 'notYet'
  if (label === VERDICT_LABELS.noClear) return 'noClear'
  if (label === VERDICT_LABELS.notEnough) return 'notEnough'
  return 'strongIncrease'
}

export interface WorkedExampleInput {
  placeId: string
  placeLabel: string
  placeKind: PlaceKind
  variableIds: readonly string[]
  windowId: string
}

function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*\(approx\. box\)/i, '')
    .toLowerCase()
    .trim()
}

/** Published cases may carry `region.id` (Vietnam and the global case do) even though contract §9 lists only bbox and label. */
function caseRegionId(item: DetectiveCase): string | null {
  const id = (item.region as { id?: unknown }).id
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null
}

function caseMatchesPlace(item: DetectiveCase, input: WorkedExampleInput): boolean {
  const id = caseRegionId(item)
  if (id != null) return input.placeKind === 'global' ? id === GLOBAL_PLACE : id === input.placeId
  if (input.placeKind === 'global') {
    const label = normalized(item.region.label)
    return label === 'global land' || label === 'global'
  }
  const place = normalized(input.placeLabel)
  if (place === '') return false
  const parts = normalized(item.region.label)
    .split(/\s+and\s+|,\s*/)
    .map((part) => part.trim())
  return parts.includes(place)
}

/**
 * Best published case for the chosen place and variables. Place and window
 * matches outrank a variable-only match; the first case wins a tie.
 */
export function workedExample(
  cases: readonly DetectiveCase[],
  input: WorkedExampleInput,
): DetectiveCase | null {
  const variables = new Set(input.variableIds)
  let best: DetectiveCase | null = null
  let bestScore = 0
  for (const item of cases) {
    const place = caseMatchesPlace(item, input)
    const windowMatch = item.window === input.windowId
    const variable = item.evidence.some((evidence) => variables.has(evidence.variable))
    if (!place && !variable) continue
    const score = (place ? 4 : 0) + (windowMatch ? 2 : 0) + (variable ? 1 : 0)
    if (score > bestScore) {
      best = item
      bestScore = score
    }
  }
  return best
}

export interface SuggestedPlace {
  id: string
  label: string
}

/**
 * One-click shortcuts for the countries named by a published case
 * ("China and Russia" → China, Russia). Data-driven, never a hand-picked list.
 */
export function suggestedPlaces(
  countries: readonly { id: string; label: string }[],
  cases: readonly DetectiveCase[],
): SuggestedPlace[] {
  const byLabel = new Map(countries.map((country) => [normalized(country.label), country]))
  const seen = new Set<string>()
  const out: SuggestedPlace[] = []
  for (const item of cases) {
    for (const part of item.region.label.split(/\s+and\s+|,\s*/)) {
      const country = byLabel.get(normalized(part))
      if (!country || seen.has(country.id)) continue
      seen.add(country.id)
      out.push({ id: country.id, label: country.label })
    }
  }
  return out
}

function clean(value: string | null): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Read `place`, `topic` and `w` from an `#/investigate` hash. Anything else
 * (another page, a malformed hash) yields an empty patch instead of throwing.
 */
export function parseInvestigateHash(hash: string): Partial<InvestigateState> {
  const raw = hash.replace(/^#/, '')
  const queryAt = raw.indexOf('?')
  const page = (queryAt === -1 ? raw : raw.slice(0, queryAt)).replace(/^\/+/, '').toLowerCase()
  if (page !== 'investigate') return {}
  const params = new URLSearchParams(queryAt === -1 ? '' : raw.slice(queryAt + 1))
  const patch: Partial<InvestigateState> = {}
  const place = clean(params.get('place'))
  if (place) patch.place = place
  const topic = clean(params.get('topic'))
  if (topic) patch.topic = topic
  const windowId = clean(params.get('w'))
  if (windowId) patch.windowId = windowId
  return patch
}

/** Canonical shareable hash, e.g. `#/investigate?place=country_704&topic=heat&w=2001-2024`. */
export function serializeInvestigateHash(state: InvestigateState): string {
  const params = new URLSearchParams()
  params.set('place', state.place)
  params.set('topic', state.topic)
  params.set('w', state.windowId)
  return `#/investigate?${params.toString()}`
}

export interface InitialStateInput {
  /** Current `window.location.hash` (the shared router keeps only `w`). */
  hash: string
  /** Fragment of this document's navigation-timing URL, if the browser exposes it. */
  navHash: string | null
  /** Last answers saved in this tab. */
  stored: InvestigateState | null
  /** Navigation fragment already consumed by a previous page view in this tab. */
  storedNavHash: string | null
  /** Window chosen by the shared app state when the hash has none. */
  defaultWindowId: string
}

/**
 * Decide the first answer from, in order: the current hash, the full URL this
 * document was opened with (before the shared router rewrote it), and the last
 * answers in this tab. The shared router owns only `w`, so `place`/`topic` are
 * restored here (see the report's request to the architect).
 */
export function initialInvestigateState(input: InitialStateInput): InvestigateState {
  const fromHash = parseInvestigateHash(input.hash)
  const navUsable = input.navHash != null && input.navHash !== input.storedNavHash
  const fromNav = navUsable ? parseInvestigateHash(input.navHash as string) : {}
  const stored = input.stored ?? DEFAULT_INVESTIGATE
  return {
    place: fromHash.place ?? fromNav.place ?? stored.place,
    topic: fromHash.topic ?? fromNav.topic ?? stored.topic,
    windowId: fromHash.windowId ?? (input.defaultWindowId || DEFAULT_WINDOW_ID),
  }
}
