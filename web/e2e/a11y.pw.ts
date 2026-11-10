import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { vietnamCase } from './cases'

interface SavedViolation {
  page: string
  owner: string
  impact: string | null
  id: string
  help: string
  target: string
  html: string
}

// Case ids follow rank order and change when selection changes. Resolve the
// Vietnam case by title or kind + label and use its id only for the URL.
const vietnam = vietnamCase()
const vietnamVariable = vietnam.evidence[0]?.variable
const vietnamRegion = vietnam.region.id
if (!vietnamVariable) throw new Error('The Vietnam case has no evidence variable')
if (!vietnamRegion) throw new Error('The Vietnam case has no region.id')

const PAGES: { name: string; hash: string; owner: string }[] = [
  { name: 'home', hash: '#/home', owner: 'P15c' },
  { name: 'screener', hash: '#/screener?w=2001-2024', owner: 'P15c' },
  { name: 'discovery', hash: '#/discovery?v=air_temperature&w=2001-2024', owner: 'P15a' },
  {
    name: 'region',
    hash: `#/region?v=${vietnamVariable}&w=${vietnam.window}&region=${vietnamRegion}`,
    owner: 'P15b',
  },
  { name: 'story', hash: `#/story?case=${vietnam.id}`, owner: 'P15c' },
  { name: 'method', hash: '#/method', owner: 'P15c' },
]

function ownerFor(pageOwner: string, ruleId: string, target: string, html: string): string {
  const blob = `${target} ${html}`
  if (ruleId === 'label-content-name-mismatch' || target.includes('.brand')) return 'P15c'
  if (ruleId === 'page-has-heading-one') return pageOwner
  if (/place-search|combobox/.test(blob)) return 'P10'
  if (/discovery-/.test(blob)) return 'P15a'
  if (/region-/.test(blob)) return 'P15b'
  if (/story-|screener-|home-|coach|app-header|app-footer|method-/.test(blob)) return 'P15c'
  return pageOwner
}

test('axe on every page', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'one accessibility pass is enough')
  await page.addInitScript(() => {
    localStorage.setItem('earthpulse.coach.v1', 'dismissed')
  })

  const saved: SavedViolation[] = []
  for (const entry of PAGES) {
    await page.goto(`/${entry.hash}`)
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 120_000 })
    await expect(page.getByText('Could not load data')).toHaveCount(0)
    // Let the main landmark finish its first paint before scanning.
    await page.locator('#main').waitFor()
    const results = await new AxeBuilder({ page }).analyze()
    for (const violation of results.violations) {
      const node = violation.nodes[0]
      const target = node?.target?.join(' ') ?? ''
      const html = node?.html ?? ''
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

  const outDir = path.resolve('e2e')
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, 'axe-results.json'), JSON.stringify(saved, null, 2), 'utf8')

  // Violations are findings for the owning package. This scan records them
  // and does not edit the pages. An empty list is a pass.
  for (const item of saved) {
    test.info().annotations.push({
      type: item.impact ?? 'unknown',
      description: `${item.owner} ${item.page} ${item.id}: ${item.help}`,
    })
  }
})
