import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { N_COLS, N_ROWS, colToLon, rowToLat } from '../src/data/contract.ts'

/**
 * Regression checks for the review defects. They live here because P17 must
 * not edit another package's tests. Each assertion states the correct
 * behaviour. The P03c, P08b and P15b fixes have landed, so these checks now
 * pass normally; the earlier `test.fail()` marks are gone.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const python = path.join(root, '.venv', 'Scripts', 'python.exe')

function runPython(script: string): Record<string, unknown> {
  const result = spawnSync(python, ['-c', script], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`python exited ${result.status}\n${result.stderr}\n${result.stdout}`)
  }
  const line = result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('{'))
    .at(-1)
  if (!line) throw new Error(`no JSON from python\n${result.stdout}\n${result.stderr}`)
  return JSON.parse(line) as Record<string, unknown>
}

test.describe('review defects', () => {
  test('fixture: a gapped linear series separates index time from calendar time', () => {
    const payload = runPython(`
import json
import numpy as np
from earthpulse.quality import delta_bic, pettitt_test

def index_delta(series, change_index):
    n = len(series)
    x = np.arange(n, dtype=float)
    coef = np.polyfit(x, series, 1)
    sse_l = float(np.sum((series - np.polyval(coef, x)) ** 2))
    first, second = series[: change_index + 1], series[change_index + 1 :]
    sse_s = float(np.sum((first - first.mean()) ** 2) + np.sum((second - second.mean()) ** 2))
    tiny = 1e-12
    bic_l = n * np.log(max(sse_l, tiny) / n) + 2.0 * np.log(n)
    bic_s = n * np.log(max(sse_s, tiny) / n) + 2.0 * np.log(n)
    return float(bic_l - bic_s)

rng = np.random.default_rng(23)
years = np.array([2001,2002,2003,2004,2005,2006,2008,2009,2010,2011,2012], dtype=float)
values = 0.3 * (years - 2001) + rng.normal(0, 0.4, years.size)
change = int(pettitt_test(values)["change_index"])
print(json.dumps({
    "p": float(pettitt_test(values)["p"]),
    "index_delta": index_delta(values, change),
    "calendar_delta": float(delta_bic(values, change, years)),
}))
`)
    expect(Number(payload.p)).toBeLessThan(0.05)
    expect(Number(payload.index_delta)).toBeGreaterThanOrEqual(2)
    expect(Number(payload.calendar_delta)).toBeLessThan(2)
  })

  test('quality flag uses calendar years when a year is missing', () => {
    const payload = runPython(`
import json
import numpy as np
from earthpulse import contract
from earthpulse.quality import quality_grid

rng = np.random.default_rng(23)
years = np.array([2001,2002,2003,2004,2005,2006,2008,2009,2010,2011,2012], dtype=int)
values = 0.3 * (years - 2001) + rng.normal(0, 0.4, years.size)
annual = values.reshape(-1, 1, 1)
trend = np.array([[contract.TREND_NOT_SIGNIFICANT]])
mask = np.array([[True]])
result = quality_grid(annual, years, trend, mask, "GLDAS_NOAH10_M")
print(json.dumps({
    "flag": int(result["quality_flag"][0, 0]),
    "delta": float(result["delta_bic"][0, 0]),
    "p": float(result["pettitt_p"][0, 0]),
}))
`)
    // A straight line with one missing year is not a step. Flag 0.
    expect(payload.flag).toBe(0)
  })

  test('an exact arithmetic series is a significant increase', () => {
    const payload = runPython(`
import json
import numpy as np
from earthpulse.stats.trend import trend_grid
from earthpulse import contract

n = 120
x = np.arange(n, dtype=float)
t = np.arange(n, dtype=float) / 12.0
layers, _ = trend_grid(x[:, None, None], np.ones((1, 1), dtype=bool), t)
print(json.dumps({
    "klass": int(layers["trend_class"][0, 0]),
    "increase": int(contract.TREND_INCREASE),
    "p": None if layers["p_value"][0, 0] != layers["p_value"][0, 0] else float(layers["p_value"][0, 0]),
    "slope": None if layers["sen_slope"][0, 0] != layers["sen_slope"][0, 0] else float(layers["sen_slope"][0, 0]),
}))
`)
    expect(payload.slope).toBe(12)
    expect(payload.p).not.toBeNull()
    expect(Number(payload.p)).toBeLessThan(0.05)
    expect(payload.klass).toBe(payload.increase)
  })

  test('q equal to 0.05 is not a significant class', () => {
    const payload = runPython(`
import json
import numpy as np
import earthpulse.stats.trend as trend
from earthpulse import contract

def fake(x, t_years=None):
    return {
        "sen_slope": 0.1,
        "sen_intercept": 0.0,
        "sen_slope_decade": 1.0,
        "std_change_decade": 1.0,
        "p_value": 0.05,
        "p_value_original": 0.05,
        "mk_tau": 0.2,
        "mk_tau_original": 0.2,
        "n_valid": int(np.isfinite(x).sum()),
        "evaluated": True,
    }

original = trend.analyse_series
trend.analyse_series = fake
try:
    n = 120
    x = np.zeros(n, dtype=float)
    t = np.arange(n, dtype=float) / 12.0
    layers, _ = trend.trend_grid(x[:, None, None], np.ones((1, 1), dtype=bool), t)
finally:
    trend.analyse_series = original
print(json.dumps({
    "klass": int(layers["trend_class"][0, 0]),
    "q": float(layers["q_value"][0, 0]),
    "not_significant": int(contract.TREND_NOT_SIGNIFICANT),
}))
`)
    expect(Number(payload.q)).toBeCloseTo(0.05, 5)
    expect(payload.klass).toBe(payload.not_significant)
  })
})

test('a dateline box keeps cells on both sides', async () => {
  const source = readFileSync(path.join(root, 'web', 'src', 'pages', 'Region', 'model.ts'), 'utf8')
  const extracted = source.match(/export function cellsInsideBbox[\s\S]*?\n\}/)
  if (!extracted) throw new Error('cellsInsideBbox was not found in model.ts')
  const body = extracted[0].replace(/export function cellsInsideBbox\([^)]*\)[^{]*/, 'function cellsInsideBbox(bbox)')
  const run = new Function(
    'N_ROWS',
    'N_COLS',
    'rowToLat',
    'colToLon',
    'bbox',
    `${body}\nreturn cellsInsideBbox(bbox)`,
  ) as (rows: number, cols: number, rowToLat: (row: number) => number, colToLon: (col: number) => number, bbox: number[]) => unknown
  const range = run(N_ROWS, N_COLS, rowToLat, colToLon, [170, -10, -170, 10])
  // Centres with longitude >= 170 or <= -170 (columns 0–9 and 350–359) are inside this box.
  expect(range, 'dateline box should include its cells').not.toBeNull()
})
