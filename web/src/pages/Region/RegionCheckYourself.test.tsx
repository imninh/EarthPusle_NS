import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CheckYourselfPanel } from './RegionCheckYourself'
import { buildCheckYourself } from './checkYourself'
import type { Country, VariableMeta } from '../../data/types'

const variable: VariableMeta = {
  id: 'root_zone_soil_moisture',
  label: 'Root-zone soil moisture',
  category: 'water',
  product: 'GLDAS_NOAH10_M',
  product_version: '2.1',
  doi: null,
  source_type: 'model',
  source_variable: 'RootMoist_inst',
  display_unit: 'kg m-2',
  slope_unit: 'kg m-2 per year',
  description: 'test',
  caveats: [],
  core: true,
  increase_means: 'wetter',
}

const country: Country = {
  id: 'country_704',
  label: 'Vietnam',
  iso_numeric: '704',
  index: 193,
  n_cells: 30,
  bbox: [102.1276, 8.5834, 109.4465, 23.3447],
}

describe('CheckYourselfPanel', () => {
  it('renders the three links with the exact URLs and safe new-tab targets', () => {
    const check = buildCheckYourself({
      selection: { kind: 'region', regionId: 'country_704' },
      variable,
      window: { start: '2001-01', end: '2024-12' },
      countries: [country],
    })
    const html = renderToStaticMarkup(<CheckYourselfPanel check={check} />)
    expect(html.match(/target="_blank"/g)).toHaveLength(3)
    expect(html.match(/rel="noopener"/g)).toHaveLength(3)
    expect(html).toContain('https://giovanni.gsfc.nasa.gov/')
    expect(html).toContain(
      'https://disc.gsfc.nasa.gov/information/tools?title=Hydrology%20Time%20Series',
    )
    expect(html).toContain('https://climexp.knmi.nl/')
  })

  it('renders the entry values and the series sentence', () => {
    const check = buildCheckYourself({
      selection: { kind: 'region', regionId: 'country_704' },
      variable,
      window: { start: '2001-01', end: '2024-12' },
      countries: [country],
    })
    const html = renderToStaticMarkup(<CheckYourselfPanel check={check} />)
    expect(html).toContain('GLDAS_NOAH10_M')
    expect(html).toContain('2.1')
    expect(html).toContain('RootMoist_inst')
    expect(html).toContain(
      'west 102.1276, south 8.5834, east 109.4465, north 23.3447',
    )
    expect(html).toContain('2001-01 to 2024-12')
    expect(html).toContain(
      'These tools draw and test one series at a time. EarthPulse adds screening across variables, correction for many tests, data-quality flags and a second dataset.',
    )
  })
})
