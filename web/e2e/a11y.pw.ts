import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

interface SavedViolation {
  page: string
  owner: string
  impact: string | null
  id: string
  help: string
  target: string
  html: string
}

const PAGES: { name: string; hash: string; ready: string; owner: string }[] = [
  {
    name: 'investigate',
    hash: '#/investigate?place=country_704&topic=heat&w=2001-2024',
    ready: '.investigate-card',
    owner: 'P20 Investigate',
  },
  {
    name: 'region',
    hash: '#/region?v=air_temperature&w=2001-2024&region=country_704',
    ready: '.region-case-head',
    owner: 'A5/P21 Region',
  },
]

function ownerFor(pageOwner: string, ruleId: string, target: string, html: string): string {
  const blob = `${target} ${html}`
  if (ruleId === 'label-content-name-mismatch') return pageOwner
  if (/controls|context-bar/.test(blob)) return 'P19 Shell'
  if (/region-/.test(blob)) return 'A5/P21 Region'
  if (/investigate-/.test(blob)) return 'P20 Investigate'
  return pageOwner
}

test('axe on Investigate and Region', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'one accessibility pass is enough')
  await page.addInitScript(() => {
    localStorage.setItem('earthpulse.coach.v1', 'dismissed')
  })

  const saved: SavedViolation[] = []
  for (const entry of PAGES) {
    await page.goto(`/${entry.hash}`)
    await expect(page.locator(entry.ready).first()).toBeVisible({ timeout: 120_000 })
    await expect(page.getByText('Could not load data')).toHaveCount(0)
    await page.locator('#main').waitFor()
    // Let the chart and the strip finish their first paint before scanning.
    await page.waitForTimeout(1_000)
    const results = await new AxeBuilder({ page }).analyze()
    for (const violation of results.violations) {
      for (const node of violation.nodes) {
        const target = node.target.join(' ')
        const html = node.html ?? ''
        saved.push({
          page: entry.name,
          owner: ownerFor(entry.owner, violation.id, target, html),
          impact: violation.impact,
          id: violation.id,
          help: violation.help,
          target,
          html: html.slice(0, 240),
        })
      }
    }
  }

  const outDir = path.resolve('e2e')
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, 'axe-results.json'), JSON.stringify(saved, null, 2), 'utf8')

  for (const item of saved) {
    test.info().annotations.push({
      type: item.impact ?? 'unknown',
      description: `${item.owner} ${item.page} ${item.id}: ${item.help}`,
    })
  }

  // Serious and critical findings are real app defects, not test defects.
  // This assertion must fail until the owning worker fixes them; never edit the app here.
  const blocking = saved.filter((item) => item.impact === 'serious' || item.impact === 'critical')
  expect(
    blocking,
    `axe found blocking violations:\n${blocking
      .map((item) => `${item.page} ${item.id} (${item.impact}) ${item.target}`)
      .join('\n')}`,
  ).toEqual([])
})
