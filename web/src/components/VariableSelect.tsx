import { useApp } from '../data/AppState'
import { sourceLabel } from '../lib/format'
import { defineStrings, useLang, useStrings } from '../i18n'
import { variableDescription, variableLabel } from '../i18n/terms'
import { categoryLabel, sourceTypeLabel } from '../pages/Region/strings.place'

export const STRINGS = defineStrings(
  { variable: 'Variable', period: 'Period', to: 'to' },
  { variable: 'Biến', period: 'Giai đoạn', to: 'đến' },
)

/** Shared variable picker, grouped by category, showing model vs satellite source. */
export function VariableSelect() {
  const { index, variableId, setVariableId, variable } = useApp()
  const s = useStrings(STRINGS)
  const { lang } = useLang()
  const categories = [...new Set(index.variables.map((v) => v.category))]
  return (
    <div className="field control">
      <label className="control-label" htmlFor="variable-select">
        {s.variable}
      </label>
      <select
        id="variable-select"
        className="select"
        value={variableId}
        onChange={(e) => setVariableId(e.target.value)}
        aria-describedby="variable-description"
      >
        {categories.map((cat) => (
          <optgroup key={cat} label={categoryLabel(cat, lang)}>
            {index.variables
              .filter((v) => v.category === cat)
              .map((v) => (
                <option key={v.id} value={v.id} title={variableDescription(v, lang)}>
                  {variableLabel(v, lang)} ({sourceTypeLabel(sourceLabel(v.source_type), lang)})
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {variable?.description ? (
        <span className="control-note" id="variable-description">
          {variableDescription(variable, lang)}
        </span>
      ) : null}
    </div>
  )
}

/** Shared analysis-window picker. */
export function WindowSelect() {
  const { index, windowId, setWindowId } = useApp()
  const s = useStrings(STRINGS)
  return (
    <div className="field control">
      <label className="control-label" htmlFor="window-select">
        {s.period}
      </label>
      <select id="window-select" className="select" value={windowId} onChange={(e) => setWindowId(e.target.value)}>
        {index.windows.map((w) => (
          <option key={w.id} value={w.id}>
            {w.start} {s.to} {w.end}
          </option>
        ))}
      </select>
    </div>
  )
}
