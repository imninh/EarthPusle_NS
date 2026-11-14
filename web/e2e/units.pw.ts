import { expect, test } from '@playwright/test'

/**
 * P17b text check: the contract's raw unit tokens must never reach a page.
 * The app formats them to °C, kg/m² and g/kg (web/src/lib/format/units.ts).
 * Check innerText, so hidden scaffolding in the DOM is not counted as visible text.
 */
const PAGES: { name: string; hash: string; ready: string }[] = [
  { name: 'home', hash: '#/home', ready: '.home-insights' },
  {
    name: 'investigate heat',
    hash: '#/investigate?place=country_704&topic=heat&w=2001-2024',
    ready: '.investigate-card',
  },
  {
    name: 'investigate atmosphere',
    hash: '#/investigate?place=country_704&topic=atmosphere&w=2001-2024',
    ready: '.investigate-card',
  },
  {
    name: 'region air temperature',
    hash: '#/region?v=air_temperature&w=2001-2024&region=country_704',
    ready: '.region-case-head',
  },
  {
    name: 'region precipitation',
    hash: '#/region?v=precipitation&w=2001-2024&region=country_704',
    ready: '.region-case-head',
  },
  { name: 'discovery', hash: '#/discovery?v=air_temperature&w=2001-2024', ready: '[aria-label="Map layer"]' },
  { name: 'screener', hash: '#/screener?w=2001-2024', ready: '.screener-row' },
  { name: 'story', hash: '#/story', ready: '.story-card' },
  { name: 'method', hash: '#/method', ready: 'h1' },
]

const RAW_UNITS = ['degC', 'kg m-2', 'g kg-1'] as const

test('raw contract units appear on no page', async ({ page }) => {
  for (const entry of PAGES) {
    await page.goto(`/${entry.hash}`)
    await expect(page.locator(entry.ready).first()).toBeVisible({ timeout: 120_000 })
    await page.waitForTimeout(500)
    const text = await page.locator('body').innerText()
    const dom = await page.locator('body').textContent()
    for (const unit of RAW_UNITS) {
      expect(text, `${entry.name} (${entry.hash}) shows the raw unit "${unit}"`).not.toContain(unit)
      expect(dom, `${entry.name} (${entry.hash}) contains the raw unit "${unit}" in the DOM`).not.toContain(unit)
    }
  }
})
