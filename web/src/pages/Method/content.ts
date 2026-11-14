// Static explanatory content for the Method page. Numbers are rendered from the
// published index at runtime; this file contains only method descriptions.

export interface MethodStep {
  id: string
  title: string
  technical: string
  body: string
  why: string
}

export const METHOD_STEPS: readonly MethodStep[] = [
  {
    id: 'data',
    title: 'Data',
    technical: 'harmonized monthly products',
    body:
      'We download monthly NASA products and put them on one 1° grid, one land mask and one time axis. ' +
      'Every product uses the same months and the same 2001–2020 baseline, so later differences are not caused by mismatched calendars.',
    why: 'Comparable inputs are the foundation of every later test.',
  },
  {
    id: 'anomalies',
    title: 'Anomalies',
    technical: 'monthly anomalies',
    body:
      'We subtract the 2001–2020 monthly climatology from each cell, leaving one anomaly per month. ' +
      'This removes the normal seasonal cycle, so a trend means a change beyond the usual annual rhythm.',
    why: 'Without this step, every summer would look like a rising trend.',
  },
  {
    id: 'trend',
    title: 'Trend and significance',
    technical: "Sen's slope + Hamed–Rao MK",
    body:
      "Sen's slope is the median of all pairwise slopes and is robust to single outliers. " +
      'The Hamed–Rao modified Mann–Kendall test asks whether a monotonic trend is unlikely under no change while allowing for autocorrelation.',
    why: 'A slope alone is not enough; we also need to know whether it could be noise.',
  },
  {
    id: 'fdr',
    title: 'Multiple testing',
    technical: 'Benjamini–Hochberg FDR',
    body:
      'Testing thousands of grid cells produces false positives by chance. ' +
      'Benjamini–Hochberg correction controls the false-discovery rate across the evaluated cells in each map.',
    why: 'This keeps “significant” meaningful when many cells are tested at once.',
  },
  {
    id: 'quality',
    title: 'Quality check',
    technical: 'Pettitt step test + ΔBIC',
    body:
      'A Pettitt change-point test plus a step-versus-linear comparison checks whether a sudden jump fits better than a gradual trend. ' +
      'The result is a warning to read the evidence, not a verdict on whether the jump is real.',
    why: 'Some apparent trends are driven by a change in the input data rather than by the climate.',
  },
  {
    id: 'witness',
    title: 'Second witness',
    technical: 'independent NASA product',
    body:
      'The same trend test is repeated on an independent NASA product for the same physical quantity. ' +
      'Agreement is corroboration, not ground truth: MERRA-2 is also a reanalysis and GPCP shares rain-gauge inputs with IMERG.',
    why: 'A second dataset makes the detective story stronger, but it does not replace judgement.',
  },
  {
    id: 'region',
    title: 'Region average',
    technical: 'area-weighted mean series',
    body:
      'For a country, a region or a box you choose, we average the cell anomalies into one monthly series, giving each cell a weight by its area. ' +
      'The trend test then runs once on that series, with the Hamed–Rao modified Mann–Kendall test and no false-discovery correction.',
    why: 'One test on one series is easy to repeat, but an average can hide cells that move in opposite directions.',
  },
  {
    id: 'interval',
    title: 'Rate and 95% interval',
    technical: 'rate of change with its interval',
    body:
      'We report the rate of change together with a 95% interval, the range that is likely to contain the true rate. ' +
      'If the interval includes zero, the direction is not yet proven, and a longer record can change that.',
    why: 'An interval shows how sure we are, which a single number cannot.',
  },
]

export const METHOD_LIMITATIONS: readonly string[] = [
  'GLDAS-2.1 forcing is not temporally homogeneous: radiation was rescaled from 2008 and shows an uncorrected shift after 2011. Part of a GLDAS trend can be a data artefact.',
  'A significant trend is evidence to read, not proof of cause. FDR controls false discoveries but does not make a trend causal.',
  'Greenland and permanent snow/ice cells are masked because the land model has no glacier or ice-sheet model.',
  '12-year windows have less power to detect sudden shifts; when a full 24-year quality check exists, it is used for the shorter windows.',
  'MERRA-2 is a reanalysis and GPCP shares rain-gauge inputs with IMERG; the second witness is corroboration, not ground truth.',
  'Correlation and co-located trends are not causation.',
]

export interface MethodDocLink {
  label: string
  href: string
  description: string
}

export const METHOD_DOC_LINKS: readonly MethodDocLink[] = [
  {
    label: 'Scientific methodology',
    href: '../docs/SCIENTIFIC_METHODOLOGY.md',
    description: 'Full method, baselines and validation notes.',
  },
  {
    label: 'Limitations',
    href: '../docs/LIMITATIONS.md',
    description: 'What the data can and cannot support.',
  },
  {
    label: 'Data contract',
    href: '../docs/DATA_CONTRACT.md',
    description: 'Grid, file layout and every published field.',
  },
]

// ---------------------------------------------------------------------------
// "How EarthPulse answers the challenge". Every row names a feature that exists
// in web/src today; the quoted phrases are short pieces of the challenge text
// (docs/CHALLENGE_BRIEF.md). `page` is a hash route used with the app's navigate().
// ---------------------------------------------------------------------------

export type ChallengePage = 'investigate' | 'screener' | 'discovery' | 'region' | 'story' | 'method'

export interface ChallengeRow {
  id: string
  kind: 'Objective' | 'Consideration'
  /** Short quote from the challenge text. */
  phrase: string
  /** Where the feature is in the app, in plain words. */
  where: string
  page: ChallengePage
  linkLabel: string
}

export const CHALLENGE_ROWS: readonly ChallengeRow[] = [
  {
    id: 'variables',
    kind: 'Objective',
    phrase: 'variables of interest',
    where: 'The Variables page ranks every published variable by how much of the land shows a trend.',
    page: 'screener',
    linkLabel: 'Open Variables',
  },
  {
    id: 'region',
    kind: 'Objective',
    phrase: 'a particular region',
    where: 'Pick a country, a region or a box of your own on the Region page.',
    page: 'region',
    linkLabel: 'Open the Region page',
  },
  {
    id: 'series',
    kind: 'Objective',
    phrase: 'a time series',
    where: 'The Region page draws the monthly series for your place and lets you change the period.',
    page: 'region',
    linkLabel: 'Open the Region page',
  },
  {
    id: 'rate',
    kind: 'Objective',
    phrase: 'the Mann-Kendall test, or confidence intervals',
    where: 'The Region page gives the rate of change with a 95% interval and a Hamed–Rao Mann–Kendall test.',
    page: 'region',
    linkLabel: 'Open the Region page',
  },
  {
    id: 'definitions',
    kind: 'Consideration',
    phrase: 'simple definitions of the variables',
    where: 'The Map shows a one-sentence definition of the chosen variable, and the “?” buttons explain each term.',
    page: 'discovery',
    linkLabel: 'Open the Map',
  },
  {
    id: 'questions',
    kind: 'Consideration',
    phrase: 'a short series of questions',
    where: 'Investigate asks where, what and when, then shows the matching variables.',
    page: 'investigate',
    linkLabel: 'Open Investigate',
  },
  {
    id: 'demos',
    kind: 'Consideration',
    phrase: 'demonstration examples',
    where: 'The Cases page walks through the published detective cases one step at a time.',
    page: 'story',
    linkLabel: 'Open Cases',
  },
  {
    id: 'not-significant',
    kind: 'Consideration',
    phrase: 'interesting even if it doesn’t reach the level of significance',
    where: 'A weak trend is shown as “a direction, not yet significant”, never as “no change”.',
    page: 'investigate',
    linkLabel: 'Open Investigate',
  },
  {
    id: 'seasonal',
    kind: 'Consideration',
    phrase: 'once the seasonal cycle is removed',
    where: 'Every chart and test uses monthly anomalies, so the normal yearly rhythm is already taken out.',
    page: 'region',
    linkLabel: 'Open the Region page',
  },
]

export function challengeHref(page: ChallengePage): string {
  return `#/${page}`
}

// ---------------------------------------------------------------------------
// Tools to check our numbers
// ---------------------------------------------------------------------------

export interface ToolLink {
  label: string
  href: string
}

export const CHECK_TOOLS: readonly ToolLink[] = [
  { label: 'Giovanni', href: 'https://giovanni.gsfc.nasa.gov/' },
  {
    label: 'Hydrology Time Series',
    href: 'https://disc.gsfc.nasa.gov/information/tools?title=Hydrology%20Time%20Series',
  },
  { label: 'KNMI Climate Explorer', href: 'https://climexp.knmi.nl/' },
]

export const CHECK_TOOLS_SENTENCE =
  'These tools draw and test one series at a time. EarthPulse adds screening across variables, correction for many tests, data-quality flags and a second dataset.'

// ---------------------------------------------------------------------------
// Classroom sheet (English and Vietnamese)
// ---------------------------------------------------------------------------

export type SheetLang = 'en' | 'vi'

export interface SheetText {
  title: string
  subtitle: string
  nameLine: string
  tasksLabel: string
  tasks: readonly string[]
  sourcePrefix: string
  printLabel: string
}

export const SHEET_TEXT: Record<SheetLang, SheetText> = {
  en: {
    title: 'EarthPulse classroom sheet',
    subtitle: '15 minutes · open EarthPulse and work through three tasks',
    nameLine: 'Name',
    tasksLabel: 'Tasks',
    tasks: [
      'Is your country getting warmer? Write the rate and its 95% interval.',
      'Find a trend you should not fully trust. Which warning did the app give?',
      "Find a variable with no significant trend. What does the app say about it, and why is that not the same as 'no change'?",
    ],
    sourcePrefix: 'Data sources',
    printLabel: 'Print this sheet',
  },
  vi: {
    title: 'Phiếu học tập EarthPulse',
    subtitle: '15 phút · mở EarthPulse và làm ba nhiệm vụ',
    nameLine: 'Họ tên',
    tasksLabel: 'Nhiệm vụ',
    tasks: [
      'Nước bạn có đang ấm lên không? Ghi tốc độ thay đổi và khoảng tin cậy 95%.',
      'Tìm một xu hướng mà bạn chưa nên tin hoàn toàn. Ứng dụng đã cảnh báo điều gì?',
      "Tìm một biến chưa có xu hướng có ý nghĩa thống kê. Ứng dụng nói gì, và vì sao điều đó không có nghĩa là 'không thay đổi'?",
    ],
    sourcePrefix: 'Nguồn dữ liệu',
    printLabel: 'In phiếu này',
  },
}

export interface SourceProduct {
  product: string
  version?: string | null
  doi?: string | null
}

/** "Prefix: Product version, DOI x; ..." built from the published index; duplicates removed. */
export function sheetSourceLine(prefix: string, products: readonly SourceProduct[]): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const item of products) {
    const name = [item.product, item.version].filter(Boolean).join(' ')
    const text = item.doi ? `${name}, DOI ${item.doi}` : name
    if (!name || seen.has(text)) continue
    seen.add(text)
    parts.push(text)
  }
  return parts.length > 0 ? `${prefix}: ${parts.join('; ')}` : prefix
}

export function sentenceCount(text: string): number {
  return text
    .split(/[.!?](?:\s|$)/)
    .map((part) => part.trim())
    .filter(Boolean).length
}
