// A3: the "Check it yourself" block. It only shows values built by
// buildCheckYourself; the links are the three tools listed in the challenge's
// Resources tab, with no deep links or query strings added.

import type { CheckYourselfModel } from './checkYourself'

const SERIES_NOTE =
  'These tools draw and test one series at a time. EarthPulse adds screening across variables, correction for many tests, data-quality flags and a second dataset.'

export function CheckYourselfPanel({ check }: { check: CheckYourselfModel }) {
  const { values, tools } = check
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
        <p className="label-caps region-check-heading">Values to enter</p>
        <dl className="region-check-values">
          <dt>Product short name</dt>
          <dd className="num-mono">{values.product}</dd>
          <dt>Product version</dt>
          <dd className="num-mono">{values.productVersion}</dd>
          <dt>Source variable</dt>
          <dd className="num-mono">{values.sourceVariable}</dd>
          {values.box && (
            <>
              <dt>Bounding box</dt>
              <dd className="num-mono">
                west {values.box.west}, south {values.box.south}, east {values.box.east}, north{' '}
                {values.box.north}
              </dd>
            </>
          )}
          <dt>Period</dt>
          <dd className="num-mono">{values.period}</dd>
        </dl>
      </div>

      <p className="region-check-sentence">{SERIES_NOTE}</p>
    </div>
  )
}
