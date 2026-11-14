// A3: the "Check it yourself" block. It only shows values built by
// buildCheckYourself; the links are the three tools listed in the challenge's
// Resources tab, with no deep links or query strings added.

import { useStrings } from '../../i18n'
import type { CheckYourselfModel } from './checkYourself'
import { CHECK_STRINGS } from './strings'

export function CheckYourselfPanel({ check }: { check: CheckYourselfModel }) {
  const { values, tools } = check
  const s = useStrings(CHECK_STRINGS)
  return (
    <div className="region-check">
      <ul className="region-check-links">
        {tools.map((tool) => (
          <li key={tool.id}>
            <a className="region-check-link" href={tool.url} target="_blank" rel="noopener">
              {tool.label}
            </a>
          </li>
        ))}
      </ul>

      <div className="region-check-entry">
        <p className="label-caps region-check-heading">{s.valuesToEnter}</p>
        <dl className="region-check-values">
          <dt>{s.productShortName}</dt>
          <dd className="num-mono">{values.product}</dd>
          <dt>{s.productVersion}</dt>
          <dd className="num-mono">{values.productVersion}</dd>
          <dt>{s.sourceVariable}</dt>
          <dd className="num-mono">{values.sourceVariable}</dd>
          {values.box && (
            <>
              <dt>{s.boundingBox}</dt>
              <dd className="num-mono">
                {s.box(values.box.west, values.box.south, values.box.east, values.box.north)}
              </dd>
            </>
          )}
          <dt>{s.period}</dt>
          <dd className="num-mono">{values.period}</dd>
        </dl>
      </div>

      <p className="region-check-sentence">{s.note}</p>
    </div>
  )
}
