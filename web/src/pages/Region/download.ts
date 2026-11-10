// P15b download & cite helpers: pure builders plus small DOM actions.

export interface CsvSeries {
  months: readonly string[]
  values: readonly (number | null)[]
  anomalies: readonly (number | null)[]
  witnessAnomalies?: readonly (number | null)[] | null
  validFraction?: readonly (number | null)[] | null
}

function csvCell(value: string | number | null | undefined): string {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * CSV columns required by the contract: months, values, anomalies, witness
 * anomalies, valid_cell_fraction. Missing values are empty cells, not zeros.
 */
export function buildRegionCsv(series: CsvSeries): string {
  const lines = ['month,value,anomaly,witness_anomaly,valid_cell_fraction']
  for (let i = 0; i < series.months.length; i++) {
    lines.push(
      [
        csvCell(series.months[i]),
        csvCell(series.values[i]),
        csvCell(series.anomalies[i]),
        csvCell(series.witnessAnomalies?.[i]),
        csvCell(series.validFraction?.[i]),
      ].join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

export interface CitationInput {
  url: string
  place: string
  variableLabel: string
  windowLabel: string
  product: string
  productVersion: string
  doi: string | null
  witness: {
    label: string
    product: string
    version: string
    doi: string | null
  } | null
  method: string
  witnessMethod: string | null
}

/** EarthPulse URL + product DOIs + the method line, as one copyable block. */
export function buildCitation(input: CitationInput): string {
  const lines = [
    `EarthPulse: ${input.url}`,
    `${input.place} — ${input.variableLabel}, ${input.windowLabel}`,
    `Main product: ${input.product} ${input.productVersion}`.trim(),
    input.doi ? `Main DOI: ${input.doi}` : 'Main DOI: not listed',
    input.method ? `Method: ${input.method}` : '',
  ]
  if (input.witness) {
    lines.push(
      `Second witness: ${input.witness.label} (${input.witness.product} ${input.witness.version})`.trim(),
      input.witness.doi ? `Witness DOI: ${input.witness.doi}` : 'Witness DOI: not listed',
    )
    if (input.witnessMethod) lines.push(`Witness method: ${input.witnessMethod}`)
  }
  return lines.filter(Boolean).join('\n')
}

export function downloadTextFile(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

async function fallbackCopy(text: string): Promise<boolean> {
  if (typeof document === 'undefined') return false
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  textarea.remove()
  return ok
}

export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the legacy path.
    }
  }
  return fallbackCopy(text)
}
