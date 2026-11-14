// Shared plain-language formatting. Pure functions, no React.
export { formatUnit, formatUnitIn, localizeUnitWords, sourceLabel } from './units'
export {
  GLOSSARY,
  GLOSSARY_ORDER,
  glossaryEntry,
  type GlossaryEntry,
  type TermId,
} from './glossary'
export {
  VERDICT_LABELS,
  classifyVerdict,
  plainVerdict,
  verdictKindOfLabel,
  verdictLabel,
  type PlainVerdict,
  type VerdictInput,
  type VerdictKind,
  type VerdictTone,
} from './verdict'
export { GLOSSARY_VI, UNIT_WORDS_VI, VERDICT_LABELS_VI } from './strings.vi'
