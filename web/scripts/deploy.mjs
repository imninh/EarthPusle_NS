#!/usr/bin/env node
/**
 * Build and publish the static app to a `gh-pages` branch.
 *
 * The user must have created the GitHub repository and added the remote before
 * running this. The script never creates a repository or pushes to `main`.
 *
 *   npm run deploy                 # validate, build, publish to gh-pages
 *   npm run deploy -- --dry-run    # validate and build only
 *   npm run deploy -- --base=/earthpulse/
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webDir = resolve(here, '..')
const repoRoot = resolve(webDir, '..')
const args = process.argv.slice(2)

function valueAfter(flag, fallback) {
  const hit = args.find((arg) => arg.startsWith(`${flag}=`))
  return hit ? hit.slice(flag.length + 1) : fallback
}

function normaliseBase(value) {
  const raw = (value || '/').trim()
  if (raw === '' || raw === '/') return '/'
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`
}

const base = normaliseBase(valueAfter('--base', process.env.VITE_BASE_PATH || '/earthpulse/'))
const dryRun = args.includes('--dry-run')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const python = process.platform === 'win32'
  ? join(repoRoot, '.venv', 'Scripts', 'python.exe')
  : join(repoRoot, '.venv', 'bin', 'python')

function run(command, commandArgs, options = {}) {
  const isWindowsShim = process.platform === 'win32' && command.endsWith('.cmd')
  const executable = isWindowsShim ? process.env.ComSpec || 'cmd.exe' : command
  const executableArgs = isWindowsShim
    ? ['/d', '/s', '/c', [command, ...commandArgs].join(' ')]
    : commandArgs
  console.log(`\n$ ${command} ${commandArgs.join(' ')}`)
  const result = spawnSync(executable, executableArgs, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function gitRemote() {
  const result = spawnSync('git', ['remote'], { cwd: repoRoot, encoding: 'utf8' })
  if (result.status !== 0) return ''
  return result.stdout.trim()
}

const dataIndex = join(webDir, 'public', 'data', 'index.json')
if (!existsSync(dataIndex)) {
  console.error(`Missing ${dataIndex}. Run the export/publish step first.`)
  process.exit(1)
}
if (!existsSync(python)) {
  console.error(`Missing Python at ${python}. Create the virtualenv first.`)
  process.exit(1)
}

if (!dryRun && !gitRemote()) {
  console.error('No git remote is configured. Add one first (see docs/DEPLOY.md).')
  process.exit(1)
}

// 1. Never publish unvalidated data.
run(python, ['scripts/validate_export.py', 'web/public/data', '--release'])

// 2. Build with the public sub-path, keeping `/` for local development.
run(npm, ['run', 'build'], { cwd: webDir, env: { VITE_BASE_PATH: base } })

// 3. Ensure Pages does not run Jekyll over the asset folder.
writeFileSync(join(webDir, 'dist', '.nojekyll'), '')

const index = JSON.parse(readFileSync(join(webDir, 'dist', 'data', 'index.json'), 'utf8'))
console.log(`\nBuilt with base ${base}; published data schema ${index.schema_version}.`)

if (dryRun) {
  console.log('Dry run: skipped gh-pages publish.')
  process.exit(0)
}

// 4. Publish only `dist` to the gh-pages branch. This is a push by design; the
// user explicitly runs `npm run deploy` after reading DEPLOY.md.
const ghpages = (await import('gh-pages')).default
await new Promise((resolvePromise, reject) => {
  ghpages.publish(
    join(webDir, 'dist'),
    {
      branch: 'gh-pages',
      dotfiles: true,
      message: `Publish EarthPulse ${new Date().toISOString()}`,
    },
    (error) => (error ? reject(error) : resolvePromise()),
  )
})
console.log('\nPublished to the gh-pages branch. Enable GitHub Pages in the repository settings.')
