// Browser ports of the original Mann–Kendall test, Sen's slope, and Spearman ρ.
// Sen's slope uses real time positions (P03's median of pairwise slopes).
// Mann–Kendall matches pymannkendall.original_test: tie correction is in var(S),
// tau is S / (n(n-1)/2), and z uses the continuity correction.
// Spearman matches scipy.stats.spearmanr (average ranks, then Pearson).

export interface SenSlopeResult {
  /** Per-year slope (display unit per year when t is in years). */
  slope: number
  /** median(x - slope * t) on the valid points. */
  intercept: number
}

export interface MannKendallResult {
  S: number
  /** Variance of S, with the tie correction. */
  varS: number
  z: number
  /** Two-sided normal p-value. */
  p: number
  tau: number
}

export interface SpearmanResult {
  /** Null when ρ is undefined (fewer than 2 paired points, or a constant series). */
  rho: number | null
  n: number
}

function isValid(v: number): boolean {
  return Number.isFinite(v)
}

function medianSorted(sorted: number[]): number {
  const n = sorted.length
  const mid = n >> 1
  if (n % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

function medianOf(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b)
  return medianSorted(sorted)
}

/**
 * Median of pairwise slopes (x_j - x_i) / (t_j - t_i) on finite pairs.
 * Returns the per-year slope when `t` is in years, plus the Sen intercept.
 * Returns null when fewer than two valid points have a distinct time.
 */
export function senSlope(t: ArrayLike<number>, x: ArrayLike<number>): SenSlopeResult | null {
  const n = Math.min(t.length, x.length)
  const tv: number[] = []
  const xv: number[] = []
  for (let i = 0; i < n; i++) {
    const ti = t[i]
    const xi = x[i]
    if (isValid(ti) && isValid(xi)) {
      tv.push(ti)
      xv.push(xi)
    }
  }
  const m = xv.length
  if (m < 2) return null
  const slopes: number[] = []
  for (let i = 0; i < m - 1; i++) {
    for (let j = i + 1; j < m; j++) {
      const dt = tv[j] - tv[i]
      if (dt === 0) continue
      slopes.push((xv[j] - xv[i]) / dt)
    }
  }
  if (slopes.length === 0) return null
  slopes.sort((a, b) => a - b)
  const slope = medianSorted(slopes)
  const residuals: number[] = []
  for (let i = 0; i < m; i++) residuals.push(xv[i] - slope * tv[i])
  return { slope, intercept: medianOf(residuals) }
}

/** Intercept median(x - slope * t) for a slope that was not estimated here. */
export function fitIntercept(t: ArrayLike<number>, x: ArrayLike<number>, slope: number): number | null {
  if (!isValid(slope)) return null
  const n = Math.min(t.length, x.length)
  const residuals: number[] = []
  for (let i = 0; i < n; i++) {
    const ti = t[i]
    const xi = x[i]
    if (isValid(ti) && isValid(xi)) residuals.push(xi - slope * ti)
  }
  if (residuals.length === 0) return null
  return medianOf(residuals)
}

/**
 * Two-sided survival function of the standard normal, Hastings approximation.
 * Absolute error is far inside the 1e-4 tolerance used for the reference fixture.
 */
function normalTwoSidedP(zAbs: number): number {
  if (zAbs === 0) return 1
  const t = 1 / (1 + 0.2316419 * zAbs)
  const d = 0.3989422804014327 * Math.exp(-0.5 * zAbs * zAbs)
  const tail =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const p = 2 * tail
  if (p < 0) return 0
  if (p > 1) return 1
  return p
}

/**
 * Original Mann–Kendall test on finite values, in order, with the tie correction
 * inside var(S). Returns null when fewer than two finite values are present.
 */
export function mannKendall(x: ArrayLike<number>): MannKendallResult | null {
  const valid: number[] = []
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    if (isValid(v)) valid.push(v)
  }
  const n = valid.length
  if (n < 2) return null

  let S = 0
  for (let i = 0; i < n - 1; i++) {
    const xi = valid[i]
    for (let j = i + 1; j < n; j++) {
      const d = valid[j] - xi
      if (d > 0) S += 1
      else if (d < 0) S -= 1
    }
  }

  const ties = new Map<number, number>()
  for (const v of valid) ties.set(v, (ties.get(v) ?? 0) + 1)
  let tieTerm = 0
  for (const tp of ties.values()) tieTerm += tp * (tp - 1) * (2 * tp + 5)
  const varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18

  let z = 0
  if (varS > 0 && S > 0) z = (S - 1) / Math.sqrt(varS)
  else if (varS > 0 && S < 0) z = (S + 1) / Math.sqrt(varS)

  const denom = 0.5 * n * (n - 1)
  const tau = denom === 0 ? 0 : S / denom
  return { S, varS, z, p: normalTwoSidedP(Math.abs(z)), tau }
}

function averageRanks(x: number[]): number[] {
  const n = x.length
  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b] || a - b)
  const ranks = new Array<number>(n)
  let i = 0
  while (i < n) {
    let j = i
    while (j + 1 < n && x[order[j + 1]] === x[order[i]]) j++
    const average = (i + 1 + (j + 1)) / 2
    for (let k = i; k <= j; k++) ranks[order[k]] = average
    i = j + 1
  }
  return ranks
}

function pearson(a: number[], b: number[]): number | null {
  const n = a.length
  if (n < 2) return null
  let meanA = 0
  let meanB = 0
  for (let i = 0; i < n; i++) {
    meanA += a[i]
    meanB += b[i]
  }
  meanA /= n
  meanB /= n
  let num = 0
  let denA = 0
  let denB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    num += da * db
    denA += da * da
    denB += db * db
  }
  if (denA === 0 || denB === 0) return null
  return num / Math.sqrt(denA * denB)
}

/** Spearman ρ on index-paired finite values. Non-finite values on either side are dropped. */
export function spearman(x: ArrayLike<number>, y: ArrayLike<number>): SpearmanResult {
  const n = Math.min(x.length, y.length)
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < n; i++) {
    const xi = x[i]
    const yi = y[i]
    if (isValid(xi) && isValid(yi)) {
      xs.push(xi)
      ys.push(yi)
    }
  }
  if (xs.length < 2) return { rho: null, n: xs.length }
  return { rho: pearson(averageRanks(xs), averageRanks(ys)), n: xs.length }
}
