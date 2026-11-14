// A4/P27: years-to-detect for the region-average series. The statistic is the
// Weatherhead et al. (1998) estimate; the trend itself stays the existing
// Hamed-Rao Mann-Kendall result (model.ts). This file only builds the residual
// from that published fit and formats the required sentence.

import { pick, type Lang } from '../../i18n'
import { yearsToDetect, type YearsToDetectResult } from '../../lib/stats'
import type { PlaceData } from './loadPlace'
import { monthsSince } from './model'
import { DETECTION_STRINGS } from './strings.text'

export interface RegionDetection {
  result: YearsToDetectResult
  /** Calendar years in the selected window, e.g. 24 or 12. */
  years: number
  sentence: string
}

function formatYears(value: number): string {
  return String(Number(value.toFixed(1)))
}

/**
 * Null unless the existing region verdict is "not significant", the Sen line
 * exists, at least 80% of the window months are usable, and n* is finite.
 */
export function regionDetection(
  place: PlaceData,
  windowStart: string,
  windowEnd: string,
  lang: Lang = 'en',
): RegionDetection | null {
  if (place.evidence.trendClass !== 'not significant' || place.trend == null) return null
  const months = place.months.filter((month) => month >= windowStart && month <= windowEnd)
  if (months.length === 0) return null

  const residual: number[] = []
  for (let index = 0; index < place.months.length; index++) {
    const month = place.months[index]
    if (month < windowStart || month > windowEnd) continue
    const anomaly = place.anomalies[index]
    if (anomaly == null || !Number.isFinite(anomaly)) continue
    const expected = place.trend.intercept + place.trend.slopePerYear * (monthsSince(windowStart, month) / 12)
    residual.push(anomaly - expected)
  }
  if (residual.length < 0.8 * months.length) return null

  const result = yearsToDetect(place.trend.slopePerYear, residual)
  if (!Number.isFinite(result.nStar)) return null

  const years = Math.round(months.length / 12)
  const sentence = pick(DETECTION_STRINGS, lang).sentence(
    formatYears(result.nStar),
    formatYears(result.lower),
    formatYears(result.upper),
    years,
  )
  return { result, years, sentence }
}
