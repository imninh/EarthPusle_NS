import { expect, test, type Page } from '@playwright/test'
import { globalCautionCase, vietnamCase } from './cases'
import { assertClean, controlOffscreen, horizontalOverflow, trackConsole } from './support'

/**
 * Demo path from docs/packages/specs/P17_qa_e2e_review.md.
 * The coach's last step button is labelled "Got it", so the tour is Next, Next,
 * then Escape (the dismiss key the spec names).
 */
async function runDemo(page: Page, mobile: boolean): Promise<void> {
  const sink = trackConsole(page)
  const overflows: string[] = []
  const offscreen: string[] = []
  const vietnam = vietnamCase()
  const vietnamRegion = vietnam.region.id
  if (!vietnamRegion) throw new Error('The Vietnam case has no region.id')
  expect(vietnamRegion, 'Vietnam case region id').toBe('country_704')
  const globalCase = globalCautionCase()

  async function checkpoint(step: string, controls: RegExp[] = []): Promise<void> {
    assertClean(sink, step)
    const overflow = await horizontalOverflow(page)
    if (overflow > 1) overflows.push(`${step}: ${overflow}px`)
    if (!mobile) return
    for (const name of controls) {
      const problem = await controlOffscreen(page, name)
      if (problem) offscreen.push(`${step}: ${problem}`)
    }
  }

  await page.addInitScript(() => {
    localStorage.clear()
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: /Which parts of Earth/ })).toBeVisible()
  await expect(page.getByText('Could not load data')).toHaveCount(0)

  const coach = page.getByRole('dialog')
  await expect(coach).toContainText('1 of 3')
  await expect(coach.getByRole('heading', { name: 'Ask an Earth-system question' })).toBeVisible()
  await coach.getByRole('button', { name: 'Next' }).click()
  await expect(coach).toContainText('2 of 3')
  await coach.getByRole('button', { name: 'Next' }).click()
  await expect(coach).toContainText('3 of 3')
  await expect(coach.getByRole('heading', { name: 'Follow the evidence' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(coach).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open the guided tour' })).toBeFocused()
  await checkpoint('home', [/Explore variables/, /Explore the map|Map/, /Follow a case|Story/])

  await page.locator('.home-actions').getByRole('button', { name: 'Explore variables' }).click()
  await expect(page.getByRole('heading', { name: 'Variable Screener' })).toBeVisible()
  // Desktop hides the extra sort bar and uses the column buttons; mobile does the opposite.
  // getByRole skips the hidden copy, so this is the control a visitor can actually press.
  const coverage = page.getByRole('button', { name: /^Coverage/ })
  await expect(coverage).toBeVisible()
  await coverage.click()
  await expect(coverage).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('table').locator('caption')).toContainText(/coverage/i)
  await checkpoint('screener', [/^Coverage/])

  const views = page.getByRole('navigation', { name: 'Views' })
  await views.getByRole('button', { name: /^(Explore the map|Map)$/ }).click()
  await expect(page.getByRole('region', { name: 'World map of the selected variable' }).or(page.locator('.discovery'))).toBeVisible()
  const layers = page.getByRole('radiogroup', { name: 'Map layer' })
  await expect(layers.getByRole('radio', { name: 'Data quality' })).toBeVisible({ timeout: 120_000 })
  const radios = layers.getByRole('radio')
  const radioCount = await radios.count()
  expect(radioCount).toBeGreaterThan(1)
  for (let index = 0; index < radioCount; index++) {
    await radios.nth(index).click()
    await expect(radios.nth(index)).toBeChecked()
    await expect(page.getByText('This layer failed to load')).toHaveCount(0)
  }
  await layers.getByRole('radio', { name: 'Data quality' }).click()
  await expect(layers.getByRole('radio', { name: 'Data quality' })).toBeChecked()
  await checkpoint('map', [/Data quality/, /Globe|Flat map/])

  const place = page.getByRole('combobox', { name: 'Place' })
  await place.fill('viet')
  await page.getByRole('option', { name: 'Vietnam', exact: true }).click()
  await expect(page.getByText('Vietnam', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Open evidence' }).click()

  const summary = page.locator('.plain-summary')
  await expect(summary).toBeVisible({ timeout: 90_000 })
  await expect(summary).toContainText(/Vietnam/)
  await expect(summary).toContainText(/2001/)
  await checkpoint('region', [/Choose a different place/])

  await views.getByRole('button', { name: /^(Follow a case|Story)$/ }).click()
  await expect(page.getByRole('heading', { name: 'Follow the evidence' })).toBeVisible()
  await page.getByRole('button', { name: 'Start with case 1' }).click()
  await expect(page).toHaveURL(/case=/)
  const firstCaseUrl = page.url()

  await page.getByRole('button', { name: 'Next case' }).click()
  await expect(page).not.toHaveURL(firstCaseUrl)
  const secondCaseUrl = page.url()
  await page.goBack()
  await expect(page).toHaveURL(firstCaseUrl)
  await page.goForward()
  await expect(page).toHaveURL(secondCaseUrl)

  let sawCaution = false
  for (let guard = 0; guard < 8; guard++) {
    const caution = page.getByRole('complementary', { name: 'Data-quality caution' })
    if ((await caution.count()) > 0) {
      sawCaution = true
      await expect(caution).toBeVisible()
      await expect(caution).toContainText(/sudden-shift|Read with caution/)
      await expect(caution).not.toContainText('Checking the published', { timeout: 90_000 })
    }
    const backToIntro = page.getByRole('button', { name: 'Back to intro' })
    if ((await backToIntro.count()) > 0 && (await backToIntro.isVisible())) break
    await page.getByRole('button', { name: 'Next case' }).click()
  }
  expect(sawCaution, 'the caution case should show the amber data-quality panel').toBe(true)
  await page.getByRole('button', { name: 'Back to intro' }).click()
  await expect(page.getByRole('heading', { name: 'How to read a case' })).toBeVisible()
  await checkpoint('story', [/Start with case 1|Next case|Back to intro/])

  // Find the case by title or kind + label, never by its rank-order id.
  await page.goto(`/#/story?case=${vietnam.id}`)
  await expect(page.getByRole('heading', { name: /Vietnam is warming/ })).toBeVisible()
  await page.reload()
  await expect(page).toHaveURL(new RegExp(`case=${vietnam.id}`))
  await expect(page.getByRole('heading', { name: /Vietnam is warming/ })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Data-quality caution' })).toBeVisible()

  // P15d: the country case must open its exact country domain, not the bbox.
  await page.getByRole('button', { name: 'Open evidence' }).click()
  await expect(page).toHaveURL(new RegExp(`region=${vietnamRegion}`))
  await expect(page.locator('.plain-summary')).toBeVisible({ timeout: 90_000 })
  await expect(page.locator('.plain-summary')).toContainText(/Vietnam/)
  await checkpoint('vietnam case evidence')

  // The global caution case must never render the empty-region "0 / 288" line.
  await page.goto(`/#/story?case=${globalCase.id}`)
  await expect(page.getByRole('heading', { name: /Is the air drying/ })).toBeVisible()
  await expect(page.getByText(/0\s*\/\s*288/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open in Explore variables' })).toBeVisible()
  await page.getByRole('button', { name: 'Open in Explore variables' }).click()
  await expect(page.getByRole('heading', { name: 'Variable Screener' })).toBeVisible()
  await expect(page.getByText(/0\s*\/\s*288/)).toHaveCount(0)
  await checkpoint('global case')

  await page.goto('/#/discovery?v=precipitation&w=2001-2024&cell=66,192')
  await expect(page.getByText('row 66')).toBeVisible({ timeout: 120_000 })
  await page.reload()
  await expect(page).toHaveURL(/v=precipitation/)
  await expect(page).toHaveURL(/w=2001-2024/)
  await expect(page).toHaveURL(/cell=66,192/)
  await expect(page.getByText('row 66')).toBeVisible({ timeout: 120_000 })
  await checkpoint('deep link')

  await page.goto('/#/method')
  await expect(page.getByRole('heading', { level: 1, name: /From a NASA file/ })).toBeVisible()
  await page.reload()
  await expect(page).toHaveURL(/#\/method/)
  await checkpoint('method')

  if (mobile) {
    expect(overflows, `horizontal scroll\n${overflows.join('\n')}`).toEqual([])
    expect(offscreen, `controls outside the 375px viewport\n${offscreen.join('\n')}`).toEqual([])
  }
  assertClean(sink, 'end of demo')
}

test('demo path', async ({ page }, testInfo) => {
  await runDemo(page, testInfo.project.name === 'mobile')
})
