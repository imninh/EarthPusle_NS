import { useEffect, useState } from 'react'
import { Chip } from '../../components/ui'
import { useLang, useStrings } from '../../i18n'
import { useApp } from '../../data/AppState'
import { loadBreakpointYear, loadQualityFlag } from '../../data/loaders'
import type { DetectiveCase } from '../../data/types'
import { cellsInsideBbox } from '../Region/model'
import { qualityShareForRange } from '../Region/quality'
import { CAUTION_STRINGS } from './strings'
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
  const s = useStrings(CAUTION_STRINGS)
  const { lang } = useLang()

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
  const combinedWitness = witness ? combinedQualityWitnessText(witness.agreement, lang) : null

  return (
    <aside className="story-caution" aria-label={s.ariaLabel}>
      <div className="story-caution-head">
        <Chip tone="warn">{s.chip}</Chip>
        <strong>
          {sharePercent == null ? s.shareUnavailable : s.shareText(sharePercent)}
        </strong>
      </div>
      <div className="story-caution-chart" role="img" aria-label={cautionLabel(s, sharePercent, breakYear)}>
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
          ? s.noBreakYear
          : inKnownForcing
            ? s.inForcing(qualityBreakYearLead(breakYear, lang), inputChange(s, product, knownForcingPeriod))
            : s.notForcing(qualityBreakYearLead(breakYear, lang))}
        {status === 'loading' ? s.checking : null}
      </p>
      {combinedWitness != null ? (
        <p className="story-caution-combined">
          <strong>{witnessLabel}:</strong> {combinedWitness}
        </p>
      ) : null}
    </aside>
  )
}

type CautionText = typeof CAUTION_STRINGS.en

/** Same wording as the Region page helper: "documented GLDAS input change (2008–2012)". */
function inputChange(s: CautionText, product: string, period: readonly [number, number] | null): string {
  const [start, end] = period ?? [2008, 2012]
  const family = product.startsWith('GLDAS') ? 'GLDAS' : product
  return s.inputChange(family, start === end ? `${start}` : `${start}–${end}`)
}

function cautionLabel(s: CautionText, sharePercent: number | null, breakYear: number | null): string {
  const share = sharePercent == null ? s.shareUnavailable : s.labelShare(sharePercent)
  const year = breakYear == null ? s.labelNoBreak : s.labelBreak(Math.round(breakYear))
  return s.labelJoin(share, year)
}
