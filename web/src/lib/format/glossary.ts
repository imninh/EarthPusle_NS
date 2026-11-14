// Plain-language glossary shared by every page. `plain` must be one sentence a
// 16-year-old can read; `technical` keeps the exact method name for anyone who
// wants it. Wording for sudden shifts and the second witness follows
// docs/DATA_CONTRACT.md §12 and §13.

export type TermId =
  | 'significant'
  | 'trend'
  | 'rate_of_change'
  | 'anomaly'
  | 'q_value'
  | 'coverage'
  | 'sudden_shift'
  | 'second_witness'
  | 'confidence_interval'
  | 'not_yet_significant'
  | 'variable'
  | 'contrast'

export interface GlossaryEntry {
  /** Short label shown next to the "?" trigger. */
  term: string
  /** One plain sentence for a non-specialist. */
  plain: string
  /** Exact method or contract name, in brackets behind the plain phrase. */
  technical: string
}

export const GLOSSARY: Record<TermId, GlossaryEntry> = {
  significant: {
    term: 'Significant',
    plain: 'A change is called significant when it is unlikely to be produced by ordinary year-to-year noise alone.',
    technical: 'Hamed–Rao modified Mann–Kendall test with Benjamini–Hochberg false-discovery-rate control.',
  },
  trend: {
    term: 'Trend',
    plain: 'A steady direction of change over time, such as rising, falling, thickening or thinning.',
    technical: 'Monotonic trend in monthly anomalies over the analysis window.',
  },
  rate_of_change: {
    term: 'Rate of change',
    plain: 'How much the measured quantity changes in a typical year, also shown per decade to make small numbers easier to compare.',
    technical: "Sen's slope (the median of all pairwise slopes between months).",
  },
  anomaly: {
    term: 'Anomaly',
    plain: 'The difference from the usual value for that month, after the normal seasonal rhythm is removed.',
    technical: 'Monthly anomaly relative to the 2001–2020 monthly climatology.',
  },
  q_value: {
    term: 'q-value',
    plain: 'A strength-of-evidence number that already allows for testing thousands of places at once; smaller means stronger evidence.',
    technical: 'Benjamini–Hochberg false-discovery-rate adjusted p-value.',
  },
  coverage: {
    term: 'Coverage',
    plain: 'The share of months in the period that contain usable data for this variable and place.',
    technical: 'Fraction of valid monthly observations inside the analysis window.',
  },
  sudden_shift: {
    term: 'Sudden shift',
    plain: 'A step-like jump in the data rather than a smooth trend, which could be a real jump in the climate or a data artefact.',
    technical:
      'Pettitt change-point test with a step-versus-linear ΔBIC comparison (contract §12); code 2 marks a break during the documented 2008–2012 GLDAS input change.',
  },
  second_witness: {
    term: 'Second witness',
    plain: 'A second, independent NASA dataset is tested the same way, and agreement makes the evidence stronger.',
    technical:
      'Same Sen slope, Hamed–Rao Mann–Kendall test and BH-FDR control on an independent NASA product (contract §13).',
  },
  confidence_interval: {
    term: 'Confidence interval',
    plain: 'A range that is likely to contain the true rate of change, and if the range includes zero then the direction is not yet proven.',
    technical: '95% rank-based confidence interval for the Sen slope (Sen 1968; Gilbert 1987).',
  },
  not_yet_significant: {
    term: 'Not yet significant',
    plain: 'A direction is visible, but the evidence is not strong enough yet; a longer record can change this.',
    technical: 'Trend does not pass the false-discovery-rate threshold (q ≥ 0.05).',
  },
  variable: {
    term: 'Variable',
    plain: 'One measured or modelled Earth quantity, such as air temperature or soil moisture, followed month by month.',
    technical: 'A registry entry in index.json with one product, unit and source type.',
  },
  contrast: {
    term: 'Opposite trends',
    plain: 'A score near zero means one direction dominates, while a score near 0.5 means increase and decrease cover similar area.',
    technical: 'Regional contrast: area-share balance between significant increase and significant decrease (contract §6).',
  },
}

/** Stable order for the Method page's "Words we use" section. */
export const GLOSSARY_ORDER: readonly TermId[] = [
  'significant',
  'trend',
  'rate_of_change',
  'anomaly',
  'q_value',
  'coverage',
  'sudden_shift',
  'second_witness',
  'confidence_interval',
  'not_yet_significant',
]

export function glossaryEntry(id: TermId): GlossaryEntry {
  return GLOSSARY[id]
}
