#!/usr/bin/env node
/**
 * P10 T1: generate committed country polygons from Natural Earth / world-atlas.
 *
 * Usage (from the repository root or web/):
 *   node scripts/p10_build_countries.mjs
 *
 * Reads:  web/node_modules/world-atlas/countries-50m.json
 * Writes: config/countries/countries-50m.geojson
 *
 * The output FeatureCollection keeps the ISO numeric id from world-atlas and
 * exposes the country name in properties.name. Natural Earth is public domain;
 * the source is credited in the P10 report and DATA_CONTRACT.md §11.
 */

import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const webRoot = join(repoRoot, 'web')
const sourcePath = join(webRoot, 'node_modules', 'world-atlas', 'countries-50m.json')
const outputDir = join(repoRoot, 'config', 'countries')
const outputPath = join(outputDir, 'countries-50m.geojson')

const requireFromWeb = createRequire(join(webRoot, 'package.json'))
const { feature } = requireFromWeb('topojson-client')

const topology = JSON.parse(readFileSync(sourcePath, 'utf8'))
const collection = feature(topology, topology.objects.countries)

// Keep the contract's minimal shape: ISO numeric id and the Natural Earth name.
// Round coordinates to 4 decimal places (~11 m) so the committed 50m file stays
// inside the 1-3 MB budget while preserving far more detail than the 1° grid.
const roundCoordinates = (coordinates) =>
  typeof coordinates[0] === 'number'
    ? [Number(coordinates[0].toFixed(4)), Number(coordinates[1].toFixed(4))]
    : coordinates.map(roundCoordinates)

const features = collection.features.map((entry) => ({
  type: 'Feature',
  id: String(entry.id).padStart(3, '0'),
  properties: { name: entry.properties?.name ?? null },
  geometry:
    entry.geometry == null
      ? null
      : { ...entry.geometry, coordinates: roundCoordinates(entry.geometry.coordinates) },
}))

const geojson = {
  type: 'FeatureCollection',
  name: 'Natural Earth admin-0 countries (50m) via world-atlas',
  features,
}

mkdirSync(outputDir, { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(geojson)}\n`, 'utf8')

const bytes = statSync(outputPath).size
console.log(`wrote ${outputPath}`)
console.log(`features: ${features.length}`)
console.log(`bytes: ${bytes}`)
console.log('credit: Natural Earth (public domain) via world-atlas')
