// A3: values a student can enter in the three external tools. Pure, so the page
// and the tests use the same construction and no number is typed into the UI.

import { colToLon, rowToLat } from '../../data/contract'
import { pick, type Lang } from '../../i18n'
import type { Country, Region, Selection, VariableMeta, WindowMeta } from '../../data/types'

export type CheckToolId = 'giovanni' | 'hydrology' | 'climexp'

export interface CheckTool {
  id: CheckToolId
  label: string
  url: string
}

export interface CheckBox {
  west: string
  south: string
  east: string
  north: string
}

export interface CheckValues {
  product: string
  productVersion: string
  sourceVariable: string
  box: CheckBox | null
  period: string
}

export interface CheckYourselfModel {
  values: CheckValues
  tools: CheckTool[]
}

const GIOVANNI: CheckTool = {
  id: 'giovanni',
  label: 'Giovanni',
  url: 'https://giovanni.gsfc.nasa.gov/',
}

const HYDROLOGY: CheckTool = {
  id: 'hydrology',
  label: 'Hydrology Time Series',
  url: 'https://disc.gsfc.nasa.gov/information/tools?title=Hydrology%20Time%20Series',
}

const CLIMEXP: CheckTool = {
  id: 'climexp',
  label: 'KNMI Climate Explorer',
  url: 'https://climexp.knmi.nl/',
}

import { CHECK_STRINGS } from './strings'

type CheckVariable = Pick<
  VariableMeta,
  'product' | 'product_version' | 'source_variable' | 'category'
>

/** The Hydrology Time Series tool is for GLDAS water variables only. */
export function checkTools(variable: CheckVariable): CheckTool[] {
  const tools = [GIOVANNI]
  if (variable.product.startsWith('GLDAS') && variable.category === 'water') {
    tools.push(HYDROLOGY)
  }
  tools.push(CLIMEXP)
  return tools
}

function numberText(value: number): string {
  if (!Number.isFinite(value)) return ''
  return Object.is(value, -0) ? '0' : String(value)
}

function bboxForSelection(
  selection: Exclude<Selection, null>,
  regions: readonly Region[],
  countries: readonly Country[],
): [number, number, number, number] | null {
  if (selection.kind === 'bbox') return selection.bbox
  if (selection.kind === 'cell') {
    const west = Math.max(-180, colToLon(selection.col) - 0.5)
    const east = Math.min(180, colToLon(selection.col) + 0.5)
    const south = Math.max(-90, rowToLat(selection.row) - 0.5)
    const north = Math.min(90, rowToLat(selection.row) + 0.5)
    return [west, south, east, north]
  }
  const country = countries.find((item) => item.id === selection.regionId)
  if (country) return country.bbox
  const region = regions.find((item) => item.id === selection.regionId)
  return region?.bbox ?? null
}

export function buildCheckYourself(input: {
  selection: Exclude<Selection, null>
  variable: CheckVariable
  window: Pick<WindowMeta, 'start' | 'end'>
  regions?: readonly Region[]
  countries?: readonly Country[]
  lang?: Lang
}): CheckYourselfModel {
  const bbox = bboxForSelection(
    input.selection,
    input.regions ?? [],
    input.countries ?? [],
  )
  return {
    values: {
      product: input.variable.product,
      productVersion: input.variable.product_version,
      sourceVariable: input.variable.source_variable,
      box: bbox
        ? {
            west: numberText(bbox[0]),
            south: numberText(bbox[1]),
            east: numberText(bbox[2]),
            north: numberText(bbox[3]),
          }
        : null,
      period: pick(CHECK_STRINGS, input.lang ?? 'en').periodValue(input.window.start, input.window.end),
    },
    tools: checkTools(input.variable),
  }
}
