import { useLang } from '../../i18n'
import { glossaryEntry, type TermId } from '../../lib/format'
import { HelpTip } from './HelpTip'

/**
 * A one-click plain explanation built from the shared glossary. The plain
 * sentence comes first; the exact method name stays in brackets behind it.
 */
export function GlossaryTip({ term }: { term: TermId }) {
  const { lang } = useLang()
  const entry = glossaryEntry(term, lang)
  return (
    <HelpTip label={entry.term} description={`${entry.plain} (${entry.technical})`}>
      {entry.plain}{' '}
      <span className="ui-help-technical">({entry.technical})</span>
    </HelpTip>
  )
}
