import { expect, test } from '@playwright/test'
import { assertClean, trackConsole } from './support'

/** Current-page coverage for the frozen UI (P17b, 14 Nov). */

test('Home: night hero, globe and Start an investigation', async ({ page }) => {
  const sink = trackConsole(page)
  await page.addInitScript(() => localStorage.setItem('earthpulse.coach.v1', 'dismissed'))
  await page.goto('/#/home')
  await expect(page.getByRole('heading', { level: 1, name: /Is that trend real/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start an investigation' })).toBeVisible()
  await expect(page.locator('.home-hero')).toHaveClass(/surface-night/)
  await expect(page.locator('.home-hero-visual canvas').first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('heading', { name: 'Ask', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Read the evidence', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Cross-examine', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Start an investigation' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Start an investigation' })).toBeVisible()
  assertClean(sink, 'home')
})

test('Screener: row cards grouped by category', async ({ page }) => {
  const sink = trackConsole(page)
  await page.goto('/#/screener?w=2001-2024')
  await expect(page.getByRole('heading', { level: 1, name: 'Variable Screener' })).toBeVisible()
  for (const category of ['atmosphere', 'temperature', 'water']) {
    await expect(page.getByRole('heading', { level: 2, name: category })).toBeVisible()
  }
  await expect(page.locator('.screener-row')).toHaveCount(11)
  await expect(page.getByRole('button', { name: 'Near-surface air temperature', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: /Sort by/ })).toBeVisible()
  assertClean(sink, 'screener')
})

test('Discovery: Verdict is the default layer', async ({ page }) => {
  const sink = trackConsole(page)
  await page.goto('/#/discovery?v=air_temperature&w=2001-2024')
  await expect(page.getByRole('heading', { level: 1, name: 'Global Discovery' })).toBeVisible()
  const layers = page.getByRole('radiogroup', { name: 'Map layer' })
  await expect(layers.getByRole('radio', { name: 'Verdict' })).toBeChecked({ timeout: 120_000 })
  await expect(layers.getByRole('radio', { name: 'Data quality' })).toBeVisible()
  await expect(layers.getByRole('radio', { name: 'Second witness' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Legend' })).toContainText(
    /Each land cell gets one of four verdicts/,
  )
  assertClean(sink, 'discovery')
})

test('Story: step rail and caution step', async ({ page }) => {
  const sink = trackConsole(page)
  await page.goto('/#/story')
  await expect(page.getByRole('heading', { level: 1, name: 'Follow the evidence' })).toBeVisible()
  await page.locator('.story-step').filter({ hasText: 'Vietnam is warming' }).click()
  await expect(page).toHaveURL(/case=case-04/)
  await expect(page.getByRole('heading', { name: /Vietnam is warming/ })).toBeVisible()
  const rail = page.locator('[aria-label="Steps in this case"]')
  await expect(rail).toBeVisible()
  await expect(rail.getByRole('button')).toHaveCount(5)
  await rail.getByRole('button', { name: 'The caution' }).click()
  await expect(page.locator('[aria-label="Data-quality caution"]')).toBeVisible()
  await expect(page.locator('[aria-label="Data-quality caution"]')).toContainText(/sudden-shift|Read with caution/i)
  await rail.getByRole('button', { name: 'Limits and next steps' }).click()
  await expect(page.getByRole('button', { name: 'Open this case in the evidence page' })).toBeVisible()
  await page.getByRole('button', { name: 'Open this case in the evidence page' }).click()
  await expect(page).toHaveURL(/region=country_704/)
  await expect(page.getByRole('heading', { level: 1, name: 'Vietnam' })).toBeVisible({ timeout: 90_000 })
  assertClean(sink, 'story')
})

test('Region: years-to-detect line for a not-significant trend', async ({ page }) => {
  const sink = trackConsole(page)
  await page.goto('/#/region?v=precipitation&w=2001-2024&region=country_704')
  await expect(page.getByRole('heading', { level: 1, name: 'Vietnam' })).toBeVisible({ timeout: 90_000 })
  await expect(page.locator('.ui-stamp')).toHaveText(/a direction, not yet significant/i)
  await page.getByText('Full evidence', { exact: true }).click()
  const evidence = page.locator('.region-full-evidence')
  await expect(evidence).toContainText('Years to detect a trend')
  await expect(evidence).toContainText(
    /A trend of this size would need about .* years of data to stand out from the natural ups and downs here/,
  )
  await expect(evidence).toContainText(/The record has \d+\./)
  await expect(page.locator('.evidence-grid')).toBeVisible()
  assertClean(sink, 'region not significant')
})
