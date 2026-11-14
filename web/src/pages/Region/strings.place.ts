// Display-time translation of text that loadPlace.ts and model.ts still build in English
// (place title, detail, notes, coverage notes, method lines, progress and error messages),
// plus small word maps (trend class, variable category, source type, units, witness labels).
// English input is returned unchanged; unknown text is returned unchanged in both languages.
import { defineStrings, pick, type Lang } from '../../i18n'
import { UNIT_WORDS_VI, localizeUnitWords } from '../../lib/format'

export const PLACE_STRINGS = defineStrings(
  {
    cellTitle: (row: string, col: string) => `Cell row ${row}, column ${col}`,
    cellDetail: (coords: string) => `${coords}. One grid cell.`,
    countryDetail: (cells: string) => `Country region from Natural Earth. ${cells} grid cells inside the common mask.`,
    regionDetail: (box: string) => `Predefined region. The box is approximate.${box}`,
    regionBox: (box: string) => ` Approximate bbox [west, south, east, north]: ${box}.`,
    emptyBoxDetail: 'Approximate box. No 1° cell centre falls inside it.',
    boxDetail: 'Approximate box. Area-weighted mean of cells with data, weighted by cos(latitude).',
    customBoxTitle: (lon: string, lat: string) => `Custom box ${lon}, ${lat}`,
    labelCell: 'at this grid cell',
    labelBox: 'in this custom box',
    labelIn: (title: string) => `in ${title}`,
    noTile: (tile: string) =>
      `No monthly tile is exported for ${tile}. The evidence card still uses the precomputed grid layers.`,
    widenBox: 'Widen the box so that it contains at least one cell centre.',
    covPrecomputed: 'Precomputed coverage layer (valid months / months in the window).',
    covRegion: 'Mean of valid_cell_fraction over months in this window.',
    covEmptyBox: 'No grid-cell centres fall inside this box.',
    covBox: 'Share of in-box mask cells that contributed at least one value in this window.',
    methodCell: 'precomputed: Hamed–Rao modified Mann–Kendall, FDR-corrected',
    methodBrowser:
      'computed in browser: Hamed–Rao modified Mann–Kendall on the region average; no false-discovery correction',
    methodFallback:
      'computed in browser: original Mann–Kendall on the region average (the Hamed–Rao variance was not usable); no false-discovery correction',
    windowLabel: (start: string, end: string, id: string) => `${start} to ${end} (${id})`,
    progressTiles: (done: string, total: string) => `Loading tiles… ${done} of ${total}. Each tile is about 115 KB.`,
    progressCell: 'Loading the cell series and precomputed layers…',
    progressRegion: 'Loading the region series…',
    errCell: 'That cell is outside the grid.',
    errWindow: (id: string) => `The window ${id} is outside the month calendar.`,
    trendIncreasing: 'increasing',
    trendDecreasing: 'decreasing',
    trendNotSignificant: 'not significant',
    trendInsufficient: 'insufficient data',
    trendNotAvailable: 'not available',
    trendOutside: 'outside domain',
    categoryTemperature: 'temperature',
    categoryWater: 'water',
    categoryAtmosphere: 'atmosphere',
    sourceModel: 'model',
    sourceSatellite: 'satellite',
    sourceReanalysis: 'reanalysis',
    perDecade: 'per decade',
    perYear: 'per year',
    reanalysisWord: 'reanalysis',
    satelliteGauge: 'satellite–gauge',
  },
  {
    cellTitle: (row: string, col: string) => `Ô lưới hàng ${row}, cột ${col}`,
    cellDetail: (coords: string) => `${coords}. Một ô lưới.`,
    countryDetail: (cells: string) => `Vùng quốc gia theo Natural Earth. ${cells} ô lưới nằm trong mặt nạ chung.`,
    regionDetail: (box: string) => `Vùng định sẵn. Khung chỉ mang tính gần đúng.${box}`,
    regionBox: (box: string) => ` Khung gần đúng [tây, nam, đông, bắc]: ${box}.`,
    emptyBoxDetail: 'Khung gần đúng. Không có tâm ô lưới 1° nào nằm trong khung.',
    boxDetail: 'Khung gần đúng. Trung bình có trọng số diện tích của các ô lưới có dữ liệu, trọng số là cos(vĩ độ).',
    customBoxTitle: (lon: string, lat: string) => `Khung tự chọn ${lon}, ${lat}`,
    labelCell: 'tại ô lưới này',
    labelBox: 'trong khung tự chọn này',
    labelIn: (title: string) => `ở ${title}`,
    noTile: (tile: string) =>
      `Chưa có mảnh dữ liệu theo tháng nào cho ${tile}. Phần bằng chứng vẫn dùng các lớp lưới đã tính sẵn.`,
    widenBox: 'Hãy mở rộng khung để chứa ít nhất một tâm ô lưới.',
    covPrecomputed: 'Lớp độ phủ dữ liệu đã tính sẵn (số tháng hợp lệ / số tháng trong giai đoạn).',
    covRegion: 'Trung bình của valid_cell_fraction qua các tháng trong giai đoạn này.',
    covEmptyBox: 'Không có tâm ô lưới nào nằm trong khung này.',
    covBox: 'Tỷ lệ ô lưới mặt nạ trong khung có đóng góp ít nhất một giá trị trong giai đoạn này.',
    methodCell: 'đã tính sẵn: Mann–Kendall hiệu chỉnh theo Hamed–Rao, có kiểm soát tỷ lệ phát hiện giả (FDR)',
    methodBrowser:
      'tính ngay trong trình duyệt: Mann–Kendall hiệu chỉnh theo Hamed–Rao trên giá trị trung bình của vùng; không kiểm soát tỷ lệ phát hiện giả',
    methodFallback:
      'tính ngay trong trình duyệt: Mann–Kendall gốc trên giá trị trung bình của vùng (không dùng được phương sai Hamed–Rao); không kiểm soát tỷ lệ phát hiện giả',
    windowLabel: (start: string, end: string, id: string) => `${start} đến ${end} (${id})`,
    progressTiles: (done: string, total: string) =>
      `Đang tải các mảnh dữ liệu… ${done} trên ${total}. Mỗi mảnh nặng khoảng 115 KB.`,
    progressCell: 'Đang tải chuỗi dữ liệu của ô lưới và các lớp đã tính sẵn…',
    progressRegion: 'Đang tải chuỗi dữ liệu của vùng…',
    errCell: 'Ô lưới đó nằm ngoài lưới dữ liệu.',
    errWindow: (id: string) => `Giai đoạn ${id} nằm ngoài lịch các tháng của dữ liệu.`,
    trendIncreasing: 'tăng',
    trendDecreasing: 'giảm',
    trendNotSignificant: 'chưa có ý nghĩa thống kê',
    trendInsufficient: 'chưa đủ dữ liệu',
    trendNotAvailable: 'chưa có',
    trendOutside: 'ngoài phạm vi dữ liệu',
    categoryTemperature: 'nhiệt độ',
    categoryWater: 'nước',
    categoryAtmosphere: 'khí quyển',
    sourceModel: 'mô hình',
    sourceSatellite: 'vệ tinh',
    sourceReanalysis: 'tái phân tích',
    perDecade: UNIT_WORDS_VI.perDecade,
    perYear: UNIT_WORDS_VI.perYear,
    reanalysisWord: 'tái phân tích',
    satelliteGauge: 'vệ tinh và trạm đo',
  },
)

function esc(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build a matcher from the English template function: placeholders become captures. */
function match(text: string, build: (...parts: string[]) => string, arity: number): string[] | null {
  const marks = Array.from({ length: arity }, (_, i) => `\u0000${i}\u0000`)
  const template = esc(build(...marks))
  const pattern = new RegExp(`^${template.replace(/\u0000\d\u0000/g, '(.+?)')}$`)
  const found = pattern.exec(text)
  return found ? found.slice(1) : null
}

type Rule = { arity: number; en: (...p: string[]) => string; vi: (...p: string[]) => string }

function applyRules(text: string, rules: Rule[]): string {
  for (const rule of rules) {
    const parts = match(text, rule.en, rule.arity)
    if (parts) return rule.vi(...parts)
  }
  return text
}

const en = PLACE_STRINGS.en
const vi = PLACE_STRINGS.vi

const EXACT: [string, string][] = (
  [
    'emptyBoxDetail',
    'boxDetail',
    'labelCell',
    'labelBox',
    'widenBox',
    'covPrecomputed',
    'covRegion',
    'covEmptyBox',
    'covBox',
    'methodCell',
    'methodBrowser',
    'methodFallback',
    'progressCell',
    'progressRegion',
    'errCell',
  ] as const
).map((key) => [en[key] as string, vi[key] as string])

function exact(text: string): string | null {
  for (const [from, to] of EXACT) if (text === from) return to
  return null
}

const TITLE_RULES: Rule[] = [
  { arity: 2, en: en.cellTitle, vi: vi.cellTitle },
  {
    arity: 2,
    en: (lon, lat) => en.customBoxTitle(lon, lat),
    vi: (lon, lat) => vi.customBoxTitle(lon.replace(/ to /g, ' đến '), lat.replace(/ to /g, ' đến ')),
  },
]

/** Place title: "Cell row 4, column 7" and "Custom box ..." are generated; names stay. */
export function localizeTitle(title: string, lang: Lang): string {
  if (lang === 'en') return title
  return applyRules(title, TITLE_RULES)
}

/** The detail line under the title. */
export function localizeDetail(detail: string, lang: Lang): string {
  if (lang === 'en') return detail
  const hit = exact(detail)
  if (hit) return hit
  const cell = /^(.*)\. One grid cell\.$/.exec(detail)
  if (cell) return vi.cellDetail(cell[1])
  const country = /^Country region from Natural Earth\. (.+) grid cells inside the common mask\.$/.exec(detail)
  if (country) return vi.countryDetail(country[1])
  const region = /^Predefined region\. The box is approximate\.(?: Approximate bbox \[west, south, east, north\]: (.+)\.)?$/.exec(
    detail,
  )
  if (region) return vi.regionDetail(region[1] ? vi.regionBox(region[1]) : '')
  return detail
}

/** The place phrase with its preposition, used inside the summary sentence. */
export function localizePlaceLabel(label: string, lang: Lang): string {
  if (lang === 'en') return label
  const hit = exact(label)
  if (hit) return hit
  if (label.startsWith('in ')) return vi.labelIn(label.slice(3))
  return label
}

export function localizeNote(note: string | null, lang: Lang): string | null {
  if (note == null || lang === 'en') return note
  const hit = exact(note)
  if (hit) return hit
  const tile = /^No monthly tile is exported for (.+)\. The evidence card still uses the precomputed grid layers\.$/.exec(note)
  return tile ? vi.noTile(tile[1]) : note
}

export function localizeCoverageNote(note: string | null, lang: Lang): string | null {
  if (note == null || lang === 'en') return note
  return exact(note) ?? note
}

/** The one-line method description under the exhibits. */
export function localizeMethod(method: string, lang: Lang): string {
  if (lang === 'en') return method
  return exact(method) ?? method
}

/** "2001-01 to 2024-12 (2001-2024)" */
export function localizeWindowLabel(label: string, lang: Lang): string {
  if (lang === 'en') return label
  const found = /^(\S+) to (\S+) \((.+)\)$/.exec(label)
  return found ? vi.windowLabel(found[1], found[2], found[3]) : label
}

/** Loading progress and load errors that loadPlace.ts raises in English. */
export function localizeMessage(message: string, lang: Lang): string {
  if (lang === 'en') return message
  const hit = exact(message)
  if (hit) return hit
  const tiles = /^Loading tiles… (\d+) of (\d+)\. Each tile is about 115 KB\.$/.exec(message)
  if (tiles) return vi.progressTiles(tiles[1], tiles[2])
  const windowError = /^The window (.+) is outside the month calendar\.$/.exec(message)
  return windowError ? vi.errWindow(windowError[1]) : message
}

export function trendClassLabel(trendClass: string, lang: Lang): string {
  if (lang === 'en') return trendClass
  const table = pick(PLACE_STRINGS, lang)
  switch (trendClass) {
    case 'increasing':
      return table.trendIncreasing
    case 'decreasing':
      return table.trendDecreasing
    case 'not significant':
      return table.trendNotSignificant
    case 'insufficient data':
      return table.trendInsufficient
    case 'not available':
      return table.trendNotAvailable
    case 'outside domain':
      return table.trendOutside
    default:
      return trendClass
  }
}

export function categoryLabel(category: string, lang: Lang): string {
  if (lang === 'en') return category
  const table = pick(PLACE_STRINGS, lang)
  if (category === 'temperature') return table.categoryTemperature
  if (category === 'water') return table.categoryWater
  if (category === 'atmosphere') return table.categoryAtmosphere
  return category
}

/** Result of sourceLabel() in lib/format: 'model' | 'satellite' | 'reanalysis'. */
export function sourceTypeLabel(source: string, lang: Lang): string {
  if (lang === 'en') return source
  const table = pick(PLACE_STRINGS, lang)
  if (source === 'model') return table.sourceModel
  if (source === 'satellite') return table.sourceSatellite
  if (source === 'reanalysis') return table.sourceReanalysis
  return source
}

/** A display unit (already through formatUnit): only the rate words are translated. */
export function unitLabel(unit: string, lang: Lang): string {
  return localizeUnitWords(unit, lang)
}

/** Witness label from index.json, e.g. "MERRA-2 reanalysis". Product names stay. */
export function witnessLabelText(label: string, lang: Lang): string {
  if (lang === 'en') return label
  const table = pick(PLACE_STRINGS, lang)
  return label
    .replace(/ reanalysis$/, ` (${table.reanalysisWord})`)
    .replace(/ satellite[–-]gauge$/, ` (${table.satelliteGauge})`)
}
