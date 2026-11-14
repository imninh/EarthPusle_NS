// Pure helpers for the schema-1.3 second-witness layer (P15a).
import {
  INSUFFICIENT_DATA,
  N_COLS,
  OUTSIDE_DOMAIN,
  WITNESS_CONTRADICTED,
  WITNESS_CORROBORATED,
  WITNESS_MAIN_NOT_SIGNIFICANT,
  WITNESS_OPPOSITE_SIGN,
  WITNESS_SAME_SIGN,
} from '../data/contract'
import { defineStrings, pick, type Lang } from '../i18n'
import type { Rgba } from './gridImage'

export interface WitnessPalette {
  corroborated: Rgba
  sameSign: Rgba
  opposite: Rgba
  contradicted: Rgba
  neutral: Rgba
  insufficientA: Rgba
  insufficientB: Rgba
}

/** Teal/amber/magenta deliberately avoid the red/blue main-trend palette. */
export const WITNESS_PALETTE: WitnessPalette = {
  corroborated: [15, 118, 110, 255],
  sameSign: [94, 234, 212, 210],
  opposite: [245, 158, 11, 210],
  contradicted: [162, 28, 175, 255],
  neutral: [156, 163, 175, 190],
  insufficientA: [213, 216, 222, 255],
  insufficientB: [154, 163, 175, 255],
}

export function witnessColour(
  code: number,
  palette: WitnessPalette = WITNESS_PALETTE,
  index = 0,
  width = N_COLS,
): Rgba {
  if (code === WITNESS_CORROBORATED) return palette.corroborated
  if (code === WITNESS_SAME_SIGN) return palette.sameSign
  if (code === WITNESS_OPPOSITE_SIGN) return palette.opposite
  if (code === WITNESS_CONTRADICTED) return palette.contradicted
  if (code === WITNESS_MAIN_NOT_SIGNIFICANT) return palette.neutral
  if (code === INSUFFICIENT_DATA) {
    const row = Math.floor(index / width)
    const col = index % width
    return (row + col) % 2 === 0 ? palette.insufficientA : palette.insufficientB
  }
  return [0, 0, 0, 0]
}

export const WITNESS_TEXTS = defineStrings(
  {
    corroborated: 'A second, independent NASA dataset agrees',
    sameSign: 'Same direction, but not significant in the second dataset',
    opposite: 'Opposite direction, but not significant in the second dataset',
    contradicted: 'An independent NASA dataset disagrees: read with caution',
    mainNotSignificant: 'Main trend not significant',
    insufficient: 'Not evaluated (main or witness not eligible)',
    outside: 'Outside domain',
    unknown: (code: string) => `Unknown witness code (${code})`,
    combinedCorroborated: (label: string) =>
      `Sudden shift, but ${label} shows the same trend: more likely a real change`,
    combinedNotSeen: (label: string) => `Sudden shift not seen in ${label}: more likely a data artefact`,
  },
  {
    corroborated: 'Một bộ dữ liệu NASA thứ hai, độc lập, khớp với xu hướng này',
    sameSign: 'Cùng chiều thay đổi, nhưng chưa có ý nghĩa thống kê ở bộ dữ liệu thứ hai',
    opposite: 'Ngược chiều thay đổi, nhưng chưa có ý nghĩa thống kê ở bộ dữ liệu thứ hai',
    contradicted: 'Một bộ dữ liệu NASA độc lập không khớp: đọc thận trọng',
    mainNotSignificant: 'Xu hướng chính chưa có ý nghĩa thống kê',
    insufficient: 'Chưa đánh giá (xu hướng chính hoặc bộ dữ liệu thứ hai chưa đủ điều kiện)',
    outside: 'Ngoài phạm vi dữ liệu',
    unknown: (code: string) => `Mã bộ dữ liệu thứ hai không xác định (${code})`,
    combinedCorroborated: (label: string) =>
      `Có bước nhảy đột ngột, nhưng ${label} cho thấy cùng xu hướng: nhiều khả năng là thay đổi thật`,
    combinedNotSeen: (label: string) =>
      `Bước nhảy đột ngột không thấy ở ${label}: nhiều khả năng là sai lệch của dữ liệu`,
  },
)

export function witnessWords(code: number, lang: Lang = 'en'): string {
  const texts = pick(WITNESS_TEXTS, lang)
  if (code === WITNESS_CORROBORATED) return texts.corroborated
  if (code === WITNESS_SAME_SIGN) return texts.sameSign
  if (code === WITNESS_OPPOSITE_SIGN) return texts.opposite
  if (code === WITNESS_CONTRADICTED) return texts.contradicted
  if (code === WITNESS_MAIN_NOT_SIGNIFICANT) return texts.mainNotSignificant
  if (code === INSUFFICIENT_DATA) return texts.insufficient
  if (code === OUTSIDE_DOMAIN) return texts.outside
  return texts.unknown(String(code))
}

/**
 * Contract §13 combined reading: a quality flag is a warning, not a verdict.
 * Returns null when there is no quality flag or no witness value.
 */
export function combinedQualityWitness(
  quality: number | null,
  witness: number | null,
  witnessLabel: string,
  lang: Lang = 'en',
): string | null {
  if (quality == null || witness == null || quality < 1) return null
  const texts = pick(WITNESS_TEXTS, lang)
  if (witness === WITNESS_CORROBORATED) {
    return texts.combinedCorroborated(witnessLabel)
  }
  if (witness === WITNESS_SAME_SIGN || witness === WITNESS_MAIN_NOT_SIGNIFICANT || witness === WITNESS_OPPOSITE_SIGN || witness === WITNESS_CONTRADICTED) {
    return texts.combinedNotSeen(witnessLabel)
  }
  return null
}
