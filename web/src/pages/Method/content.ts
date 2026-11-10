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

export function sentenceCount(text: string): number {
  return text
    .split(/[.!?](?:\s|$)/)
    .map((part) => part.trim())
    .filter(Boolean).length
}
