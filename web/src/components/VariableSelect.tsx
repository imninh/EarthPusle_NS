import { useApp } from '../data/AppState'
import { sourceLabel } from '../lib/format'

/** Shared variable picker, grouped by category, showing model vs satellite source. */
export function VariableSelect() {
  const { index, variableId, setVariableId, variable } = useApp()
  const categories = [...new Set(index.variables.map((v) => v.category))]
  return (
    <div className="field control">
      <label className="control-label" htmlFor="variable-select">
        Variable
      </label>
      <select
        id="variable-select"
        className="select"
        value={variableId}
        onChange={(e) => setVariableId(e.target.value)}
        aria-describedby="variable-description"
      >
        {categories.map((cat) => (
          <optgroup key={cat} label={cat}>
            {index.variables
              .filter((v) => v.category === cat)
              .map((v) => (
                <option key={v.id} value={v.id} title={v.description}>
                  {v.label} ({sourceLabel(v.source_type)})
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {variable?.description ? (
        <span className="control-note" id="variable-description">
          {variable.description}
        </span>
      ) : null}
    </div>
  )
}

/** Shared analysis-window picker. */
export function WindowSelect() {
  const { index, windowId, setWindowId } = useApp()
  return (
    <div className="field control">
      <label className="control-label" htmlFor="window-select">
        Period
      </label>
      <select id="window-select" className="select" value={windowId} onChange={(e) => setWindowId(e.target.value)}>
        {index.windows.map((w) => (
          <option key={w.id} value={w.id}>
            {w.start} to {w.end}
          </option>
        ))}
      </select>
    </div>
  )
}
