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

export interface SenSlopeCI {
  lower: number
  upper: number
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

interface FiniteSample {
  t: number[]
  x: number[]
}

/** Index-paired finite values, preserving the original order. */
function finiteSample(t: ArrayLike<number>, x: ArrayLike<number>): FiniteSample {
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
  return { t: tv, x: xv }
}

/** Pairwise slopes (x_j - x_i) / (t_j - t_i), skipping identical times. */
function pairwiseSlopes(t: readonly number[], x: readonly number[]): number[] {
  const slopes: number[] = []
  for (let i = 0; i < t.length - 1; i++) {
    for (let j = i + 1; j < t.length; j++) {
      const dt = t[j] - t[i]
      if (dt === 0) continue
      slopes.push((x[j] - x[i]) / dt)
    }
  }
  return slopes
}

/**
 * Median of pairwise slopes (x_j - x_i) / (t_j - t_i) on finite pairs.
 * Returns the per-year slope when `t` is in years, plus the Sen intercept.
 * Returns null when fewer than two valid points have a distinct time.
 */
export function senSlope(t: ArrayLike<number>, x: ArrayLike<number>): SenSlopeResult | null {
  const sample = finiteSample(t, x)
  const m = sample.x.length
  if (m < 2) return null
  const slopes = pairwiseSlopes(sample.t, sample.x)
  if (slopes.length === 0) return null
  slopes.sort((a, b) => a - b)
  const slope = medianSorted(slopes)
  const residuals: number[] = []
  for (let i = 0; i < m; i++) residuals.push(sample.x[i] - slope * sample.t[i])
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
 * Inverse of the standard normal CDF (Acklam's rational approximation,
 * relative error about 1e-9). Returns NaN outside the open interval (0, 1).
 */
function normalQuantile(p: number): number {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return Number.NaN
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ]
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ]
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const low = 0.02425
  const high = 1 - low
  let q: number
  let r: number
  if (p < low) {
    q = Math.sqrt(-2 * Math.log(p))
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    )
  }
  if (p > high) {
    q = Math.sqrt(-2 * Math.log(1 - p))
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    )
  }
  q = p - 0.5
  r = q * q
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  )
}

/**
 * One-based rank with linear interpolation between neighbouring values.
 * Ranks outside the array clamp to its first or last element.
 */
function rankValue(sorted: readonly number[], rank: number): number {
  const n = sorted.length
  if (n === 1) return sorted[0]
  const position = Math.min(Math.max(rank, 1), n) - 1
  const lower = Math.floor(position)
  if (lower >= n - 1) return sorted[n - 1]
  const fraction = position - lower
  return sorted[lower] + (sorted[lower + 1] - sorted[lower]) * fraction
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

export interface HamedRaoResult extends MannKendallResult {
  /** Original (tie-corrected) variance of S, before the autocorrelation factor. */
  varSOriginal: number
  /** Hamed–Rao correction factor n/n*s applied to varSOriginal. */
  correction: number
  /** Finite values used. */
  n: number
}

/** Standard normal quantile for the 97.5th percentile, as scipy norm.ppf(0.975). */
const Z_975 = 1.959963984540054

/**
 * Port of pymannkendall.hamed_rao_modification_test (v1.4.3, alpha 0.05, lag=None)
 * on a series in time order. Same steps as the Python source:
 *  1. Sen slope of the raw series on its original index (pairs with a NaN are skipped),
 *  2. detrend the NaN-dropped values with slope * (1..n),
 *  3. rank the residuals (average ranks) and take the autocorrelation at lags 1..n-1
 *     with acov divisor n,
 *  4. sum (n-i)(n-i-1)(n-i-2) * r_i over lags outside +-1.96/sqrt(n),
 *  5. varS = varS_original * (1 + 2 / (n(n-1)(n-2)) * sum).
 * z and p follow the same rules as the original test (continuity correction, S = 0 gives z = 0).
 * `varS` may be non-finite or not positive when the correction misbehaves; callers must check.
 * Returns null when fewer than three finite values are present.
 */
export function hamedRaoMannKendall(x: ArrayLike<number>): HamedRaoResult | null {
  const raw: number[] = []
  for (let i = 0; i < x.length; i++) raw.push(x[i])
  const valid = raw.filter(isValid)
  const n = valid.length
  if (n < 3) return null
  const base = mannKendall(valid)
  if (!base) return null

  // Sen slope on the raw index, NaN pairs ignored (np.nanmedian).
  const slopes: number[] = []
  for (let i = 0; i < raw.length - 1; i++) {
    if (!isValid(raw[i])) continue
    for (let j = i + 1; j < raw.length; j++) {
      if (!isValid(raw[j])) continue
      slopes.push((raw[j] - raw[i]) / (j - i))
    }
  }
  if (slopes.length === 0) return null
  slopes.sort((a, b) => a - b)
  const slope = medianSorted(slopes)

  const detrended = valid.map((v, k) => v - (k + 1) * slope)
  const ranks = averageRanks(detrended)
  let mean = 0
  for (const r of ranks) mean += r
  mean /= n
  const centred = ranks.map((r) => r - mean)
  let acov0 = 0
  for (const c of centred) acov0 += c * c
  acov0 /= n

  const bound = Z_975 / Math.sqrt(n)
  let sni = 0
  for (let lag = 1; lag < n; lag++) {
    let sum = 0
    for (let k = 0; k + lag < n; k++) sum += centred[k] * centred[k + lag]
    const acf = sum / n / acov0
    // NaN fails both comparisons and is added, as in numpy, so it propagates.
    if (acf <= bound && acf >= -bound) continue
    sni += (n - lag) * (n - lag - 1) * (n - lag - 2) * acf
  }
  const correction = 1 + (2 / (n * (n - 1) * (n - 2))) * sni
  const varS = base.varS * correction

  let z: number
  if (base.S === 0) z = 0
  else if (base.S > 0) z = (base.S - 1) / Math.sqrt(varS)
  else z = (base.S + 1) / Math.sqrt(varS)
  const p = Number.isFinite(z) ? normalTwoSidedP(Math.abs(z)) : Number.NaN
  return { S: base.S, varS, z, p, tau: base.tau, varSOriginal: base.varS, correction, n }
}

const MIN_CI_POINTS = 10

/**
 * 95% rank-based confidence interval for the Sen slope (Sen 1968; Gilbert 1987).
 *
 * Uses the same finite points and pairwise slopes as `senSlope`. By default the
 * variance is the original Mann–Kendall variance of those values (tie correction,
 * no autocorrelation correction). Pass `varS` (for example the Hamed–Rao corrected
 * variance) to use that instead; a variance that is not finite and positive returns
 * null, so the caller decides on the fallback. Returns null with fewer than 10 valid points.
 */
export function senSlopeCI(
  t: ArrayLike<number>,
  x: ArrayLike<number>,
  alpha = 0.05,
  varS?: number,
): SenSlopeCI | null {
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) return null
  const sample = finiteSample(t, x)
  if (sample.x.length < MIN_CI_POINTS) return null
  const slopes = pairwiseSlopes(sample.t, sample.x)
  if (slopes.length === 0) return null
  let variance: number
  if (varS === undefined) {
    const mk = mannKendall(sample.x)
    if (!mk) return null
    variance = mk.varS
  } else {
    variance = varS
  }
  if (!Number.isFinite(variance)) return null
  if (varS !== undefined && variance <= 0) return null
  const z = normalQuantile(1 - alpha / 2)
  const c = z * Math.sqrt(variance)
  if (!Number.isFinite(c)) return null
  slopes.sort((a, b) => a - b)
  const n = slopes.length
  const m1 = (n - c) / 2
  const m2 = (n + c) / 2
  return { lower: rankValue(slopes, m1), upper: rankValue(slopes, m2 + 1) }
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

export interface YearsToDetectResult {
  /** Years of data needed; Infinity when the slope is exactly zero. */
  nStar: number
  /** Lower bound from the Weatherhead et al. (1998) uncertainty factor. */
  lower: number
  /** Upper bound from the same factor. */
  upper: number
  /** Monthly residual standard deviation (sample, ddof = 1). */
  sigma: number
  /** Lag-1 autocorrelation of the residual, clipped to [0, 0.95]. */
  phi: number
}

const PHI_MAX = 0.95

const nanDetection = (): YearsToDetectResult => ({
  nStar: Number.NaN,
  lower: Number.NaN,
  upper: Number.NaN,
  sigma: Number.NaN,
  phi: Number.NaN,
})

/**
 * Weatherhead et al. (1998) years-to-detect estimate for one monthly series.
 *
 * n* = [(3.3 * sigma / |slope|) * sqrt((1 + phi) / (1 - phi))]^(2/3)
 * B  = 4 / (3 * sqrt(m)) * sqrt((1 + phi) / (1 - phi))
 * lower = n* * exp(-B), upper = n* * exp(B)
 *
 * The formula was confirmed against Sutton et al. (2019), Earth Syst. Sci.
 * Data 11, 421-439, Eqs. 1-3, which restates Weatherhead et al. (1998).
 * This is an estimate if the same rate continued and the natural variability
 * stayed the same; it is not a forecast.
 */
export function yearsToDetect(
  slopePerYear: number,
  residual: ArrayLike<number>,
): YearsToDetectResult {
  const values: number[] = []
  for (let i = 0; i < residual.length; i++) {
    const value = residual[i]
    if (isValid(value)) values.push(value)
  }
  if (!isValid(slopePerYear) || values.length < 3) return nanDetection()

  let mean = 0
  for (const value of values) mean += value
  mean /= values.length

  let sumSquares = 0
  for (const value of values) {
    const centred = value - mean
    sumSquares += centred * centred
  }
  let sigma = Math.sqrt(sumSquares / (values.length - 1))
  if (!Number.isFinite(sigma) || sigma < 0) sigma = 0

  let cross = 0
  for (let i = 1; i < values.length; i++) {
    cross += (values[i] - mean) * (values[i - 1] - mean)
  }
  const phi = sumSquares <= 0 ? 0 : Math.min(PHI_MAX, Math.max(0, cross / sumSquares))

  if (slopePerYear === 0) {
    return {
      nStar: Number.POSITIVE_INFINITY,
      lower: Number.POSITIVE_INFINITY,
      upper: Number.POSITIVE_INFINITY,
      sigma,
      phi,
    }
  }

  const ratio = (1 + phi) / (1 - phi)
  const nStar = sigma === 0
    ? 0
    : Math.pow((3.3 * sigma / Math.abs(slopePerYear)) * Math.sqrt(ratio), 2 / 3)
  const factorB = (4 / (3 * Math.sqrt(values.length))) * Math.sqrt(ratio)
  return {
    nStar,
    lower: nStar * Math.exp(-factorB),
    upper: nStar * Math.exp(factorB),
    sigma,
    phi,
  }
}
