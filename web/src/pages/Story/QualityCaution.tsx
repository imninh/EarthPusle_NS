import { useEffect, useState } from 'react'
import { Chip } from '../../components/ui'
import { useApp } from '../../data/AppState'
import { loadBreakpointYear, loadQualityFlag } from '../../data/loaders'
import type { DetectiveCase } from '../../data/types'
import { cellsInsideBbox } from '../Region/model'
import { documentedInputChange, qualityShareForRange } from '../Region/quality'
import { caseWindowYears, cautionShare, combinedQualityWitnessText, qualityBreakYearLead, yearPosition } from './model'

type Status = 'loading' | 'ready' | 'unavailable'

/**
 * Calm, compact evidence-quality panel for a `kind: "caution"` case.
 * The flagged share comes from the case, with the area-weighted layer as a fallback;
 * the break year comes from the region quality helper over the case box.
 */
export function QualityCaution({
  item,
  variableId,
  qualityAvailable,
}: {
  item: DetectiveCase
  variableId: string
  qualityAvailable: boolean
}) {
  const [status, setStatus] = useState<Status>(qualityAvailable ? 'loading' : 'unavailable')
  const [layerShare, setLayerShare] = useState<number | null>(null)
  const [breakYear, setBreakYear] = useState<number | null>(null)
  const { index } = useApp()

  useEffect(() => {
    if (!qualityAvailable) {
      setStatus('unavailable')
      return
    }
    const range = cellsInsideBbox(item.region.bbox)
    if (!range) {
      setStatus('unavailable')
      return
    }
    let cancelled = false
    setStatus('loading')
    Promise.all([
      loadQualityFlag(variableId, item.window),
      loadBreakpointYear(variableId, item.window),
    ])
      .then(([flags, breaks]) => {
        if (cancelled) return
        if (!flags) {
          setStatus('unavailable')
          return
        }
        const summary = qualityShareForRange(flags, breaks, range)
        setLayerShare(summary.flaggedShare)
        setBreakYear(summary.breakYear)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [item.region.bbox, item.window, qualityAvailable, variableId])

  const share = cautionShare(item, layerShare)
  const sharePercent = share == null ? null : Math.round(share * 100)
  const years = caseWindowYears(item.window)
  const marker = breakYear == null ? null : yearPosition(breakYear, item.window)
  const product = item.evidence.find((evidence) => evidence.variable === variableId)?.product ?? item.evidence[0]?.product ?? ''
  const knownForcingPeriod = index.quality?.known_forcing_changes[product] ?? null
  const inKnownForcing =
    breakYear != null &&
    knownForcingPeriod != null &&
    breakYear >= knownForcingPeriod[0] &&
    breakYear <= knownForcingPeriod[1]
  const witness = item.evidence.find((evidence) => evidence.variable === variableId)?.witness
  const witnessLabel = witness
    ? index.witness?.products?.[variableId]?.label ?? witness.product
    : null
  const combinedWitness = witness ? combinedQualityWitnessText(witness.agreement) : null

  return (
    <aside className="story-caution" aria-label="Data-quality caution">
      <div className="story-caution-head">
        <Chip tone="warn">Read with caution</Chip>
        <strong>
          {sharePercent == null
            ? 'Flagged share not available'
            : `${sharePercent}% of the case's source cells carry a sudden-shift flag`}
        </strong>
      </div>
      <div className="story-caution-chart" role="img" aria-label={cautionLabel(sharePercent, breakYear)}>
        <div className="story-caution-bar" aria-hidden="true">
          <span className="story-caution-fill" style={{ width: `${sharePercent ?? 0}%` }} />
        </div>
        <div className="story-caution-axis" aria-hidden="true">
          {years ? <span>{years.start}</span> : <span />}
          {marker != null ? (
            <span className="story-caution-marker" style={{ left: `${marker}%` }}>
              <span>{Math.round(breakYear ?? 0)}</span>
            </span>
          ) : null}
          {years ? <span>{years.end}</span> : <span />}
        </div>
      </div>
      <p className="story-caution-note">
        {breakYear == null
          ? 'The published quality layers do not give a break year for this case.'
          : inKnownForcing
            ? `${qualityBreakYearLead(breakYear)}, inside a ${documentedInputChange(product, knownForcingPeriod)}: possible data discontinuity. Read the trend with caution.`
            : `${qualityBreakYearLead(breakYear)}. A sudden shift can be a real jump in the climate or a data artefact. The trend is still significant; read the evidence rather than treating the flag as a verdict.`}
        {status === 'loading' ? ' Checking the published quality layers…' : null}
      </p>
      {combinedWitness != null ? (
        <p className="story-caution-combined">
          <strong>{witnessLabel}:</strong> {combinedWitness}
        </p>
      ) : null}
    </aside>
  )
}

function cautionLabel(sharePercent: number | null, breakYear: number | null): string {
  const share = sharePercent == null ? 'Flagged share not available' : `${sharePercent}% of cells flagged`
  const year = breakYear == null ? 'break year not available' : `median break year ${Math.round(breakYear)}`
  return `${share}; ${year}.`
}
