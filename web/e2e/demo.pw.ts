import { expect, test, type Page } from '@playwright/test'
import { assertClean, controlOffscreen, horizontalOverflow, trackConsole, type ConsoleSink } from './support'

/**
 * P17b demo path, updated to the frozen UI (14 Nov).
 * Starts at the public entry the D3 talk uses: #/investigate, Vietnam + Heat.
 * The old Home → Screener → map path is covered by pages.pw.ts instead.
 */
const INVESTIGATE = '/#/investigate?place=country_704&topic=heat&w=2001-2024'
const REGION = '/#/region?v=air_temperature&w=2001-2024&region=country_704'

async function checkpoint(
  page: Page,
  sink: ConsoleSink,
  mobile: boolean,
  overflows: string[],
  offscreen: string[],
  step: string,
  controls: RegExp[] = [],
): Promise<void> {
  assertClean(sink, step)
  const overflow = await horizontalOverflow(page)
  if (overflow > 1) overflows.push(`${step}: ${overflow}px`)
  if (!mobile) return
  for (const name of controls) {
    const problem = await controlOffscreen(page, name)
    if (problem) offscreen.push(`${step}: ${problem}`)
  }
}

test('demo path: #/investigate to the case file and Check it yourself', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const sink = trackConsole(page)
  const overflows: string[] = []
  const offscreen: string[] = []
  await page.addInitScript(() => localStorage.clear())

  await page.goto(INVESTIGATE)
  await expect(page.getByRole('heading', { level: 1, name: 'Start an investigation' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Looking at Vietnam.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Where do you want to look?' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What are you curious about?' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Which years?' })).toBeVisible()

  // The new atmosphere topic and the country-report actions are part of the frozen UI.
  const atmosphere = page.getByRole('button', { name: /^Atmosphere/ })
  await expect(atmosphere).toBeVisible()
  await atmosphere.click()
  await expect(atmosphere).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: /^Heat/ }).click()
  await expect(page.getByRole('button', { name: /^Heat/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Print this report' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download image' })).toBeVisible()

  const card = page.locator('.investigate-card').filter({ hasText: 'Near-surface air temperature' })
  await expect(card).toBeVisible()
  await expect(card).toContainText("Warmer over 63.5% of Vietnam's land, read with caution")
  await expect(card).toContainText(/Sudden-shift flags cover \d+% of the area with a significant trend/)
  await checkpoint(page, sink, mobile, overflows, offscreen, 'investigate', [
    /Open the evidence for Near-surface air temperature/,
    /Print this report/,
  ])

  await card
    .getByRole('button', { name: 'Open the evidence for Near-surface air temperature' })
    .click()
  await expect(page).toHaveURL(/region=country_704/)
  await expect(page).toHaveURL(/v=air_temperature/)
  await expect(page.getByRole('heading', { level: 1, name: 'Vietnam' })).toBeVisible({ timeout: 90_000 })

  await expect(page.getByText(/Case file · Near-surface air temperature · 2001–2024/)).toBeVisible()
  await expect(page.locator('.ui-stamp')).toHaveText(/Read with caution/i)
  await expect(page.getByRole('heading', { name: 'Cross-examination' })).toBeVisible()
  await expect(page.locator('.verdict-strip-answer')).toHaveText([
    'Yes',
    'Sudden shift flagged',
    'Agrees on direction only',
  ])

  const exhibitA = page.getByRole('region', { name: 'Exhibit A · Rate of change' })
  await expect(exhibitA).toBeVisible()
  await expect(exhibitA.locator('.ui-exhibit-value')).toHaveText('+0.43')
  await expect(exhibitA.locator('.ui-ibar')).toBeVisible()
  await expect(exhibitA.locator('.ui-ibar-labels')).toContainText('+0.22')
  await expect(exhibitA.locator('.ui-ibar-labels')).toContainText('+0.63')
  await expect(page.getByRole('region', { name: 'Exhibit B · How sure are we?' })).toContainText('p = 0.0001')
  await expect(page.getByRole('region', { name: 'Exhibit C · Second dataset' })).toContainText('+0.07')

  const witness = page.getByRole('checkbox', { name: /Show second witness/ })
  await expect(witness).toBeVisible({ timeout: 90_000 })
  await expect(witness).toBeChecked()
  await witness.uncheck()
  await expect(witness).not.toBeChecked()
  await witness.check()
  await expect(witness).toBeChecked()
  await expect(page.locator('.chart-swatches').filter({ hasText: 'MERRA-2' })).toBeVisible()

  await page.getByText('Full evidence', { exact: true }).click()
  await expect(page.locator('.evidence-grid')).toBeVisible()
  await expect(page.locator('.evidence-grid')).toContainText('Second witness')
  await page.getByText('Check it yourself', { exact: true }).click()
  await expect(page.getByText('Product short name')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Giovanni' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'KNMI Climate Explorer' })).toBeVisible()
  await checkpoint(page, sink, mobile, overflows, offscreen, 'region', [
    /Choose a different place/,
    /Giovanni/,
  ])

  assertClean(sink, 'end of demo')
  if (mobile) {
    expect(overflows, `horizontal scroll\n${overflows.join('\n')}`).toEqual([])
    expect(offscreen, `controls outside the 375px viewport\n${offscreen.join('\n')}`).toEqual([])
  }
})

test('a deep link shows no coach mark', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto(INVESTIGATE)
  await expect(page.getByRole('heading', { level: 1, name: 'Start an investigation' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.goto(REGION)
  await expect(page.getByRole('heading', { level: 1, name: 'Vietnam' })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('Home shows the first-visit coach mark and the night hero', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/#/home')
  await expect(page.getByRole('heading', { level: 1, name: /Is that trend real/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start an investigation' })).toBeVisible()
  await expect(page.locator('.home-hero')).toHaveClass(/surface-night/)
  await expect(page.locator('.home-hero-visual canvas').first()).toBeVisible({ timeout: 60_000 })

  const coach = page.getByRole('dialog')
  await expect(coach).toContainText('1 of 3')
  await expect(coach.getByRole('heading', { name: 'Ask an Earth-system question' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(coach).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open the guided tour' })).toBeFocused()
})
