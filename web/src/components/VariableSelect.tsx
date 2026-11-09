import { useApp } from '../data/AppState'

/** Shared variable picker, grouped by category, showing model vs satellite source. */
export function VariableSelect() {
  const { index, variableId, setVariableId } = useApp()
  const categories = [...new Set(index.variables.map((v) => v.category))]
  return (
    <label className="field control">
      <span>Variable</span>
      <select className="select" value={variableId} onChange={(e) => setVariableId(e.target.value)}>
        {categories.map((cat) => (
          <optgroup key={cat} label={cat}>
            {index.variables
              .filter((v) => v.category === cat)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} ({v.source_type === 'model' ? 'model' : 'satellite'})
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

/** Shared analysis-window picker. */
export function WindowSelect() {
  const { index, windowId, setWindowId } = useApp()
  return (
    <label className="field control">
      <span>Period</span>
      <select className="select" value={windowId} onChange={(e) => setWindowId(e.target.value)}>
        {index.windows.map((w) => (
          <option key={w.id} value={w.id}>
            {w.start} to {w.end}
          </option>
        ))}
      </select>
    </label>
  )
}
