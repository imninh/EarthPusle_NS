#!/usr/bin/env node
/**
 * Offline demo fallback: build with the root base and serve the production
 * bundle locally, so the venue does not depend on Wi-Fi or GitHub Pages.
 *
 *   npm run preview:demo
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webDir = resolve(here, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

if (!existsSync(join(webDir, 'public', 'data', 'index.json'))) {
  console.error('Missing public/data/index.json. Run the export/publish step first.')
  process.exit(1)
}

function spawnNpm(args) {
  const isWindows = process.platform === 'win32'
  const executable = isWindows ? process.env.ComSpec || 'cmd.exe' : npm
  const executableArgs = isWindows
    ? ['/d', '/s', '/c', ['npm', ...args].join(' ')]
    : args
  return { executable, executableArgs }
}

const buildCommand = spawnNpm(['run', 'build'])
const build = spawnSync(buildCommand.executable, buildCommand.executableArgs, {
  cwd: webDir,
  env: { ...process.env, VITE_BASE_PATH: '/' },
  stdio: 'inherit',
})
if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status ?? 1)

console.log('\nServing the production build at http://localhost:4173/ (LAN: use --host).')
const previewCommand = spawnNpm([
  'run',
  'preview',
  '--',
  '--host',
  '0.0.0.0',
  '--port',
  '4173',
  '--strictPort',
])
const preview = spawn(previewCommand.executable, previewCommand.executableArgs, {
  cwd: webDir,
  env: { ...process.env, VITE_BASE_PATH: '/' },
  stdio: 'inherit',
})
preview.on('exit', (code) => process.exit(code ?? 0))
