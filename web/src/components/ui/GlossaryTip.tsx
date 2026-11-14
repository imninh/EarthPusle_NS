import { GLOSSARY, type TermId } from '../../lib/format'
import { HelpTip } from './HelpTip'

/**
 * A one-click plain explanation built from the shared glossary. The plain
 * sentence comes first; the exact method name stays in brackets behind it.
 */
export function GlossaryTip({ term }: { term: TermId }) {
  const entry = GLOSSARY[term]
  return (
    <HelpTip label={entry.term} description={`${entry.plain} (${entry.technical})`}>
      {entry.plain}{' '}
      <span className="ui-help-technical">({entry.technical})</span>
    </HelpTip>
  )
}
