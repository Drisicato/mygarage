import { describe, it, expect } from 'vitest'
import { ALL_NAV_SHOWN, readNavToggles } from '../navToggles'

describe('readNavToggles', () => {
  it('shows every tab with no rows: an older instance or a failed fetch never hides one', () => {
    expect(readNavToggles([])).toEqual(ALL_NAV_SHOWN)
  })

  it('hides a tab only when its row says exactly "false"', () => {
    expect(
      readNavToggles([
        { key: 'nav_address_book_enabled', value: 'false' },
        { key: 'nav_poi_finder_enabled', value: 'true' },
      ]),
    ).toEqual({ nav_address_book_enabled: false, nav_poi_finder_enabled: true })
  })

  it('reads anything else as shown', () => {
    expect(
      readNavToggles([
        { key: 'nav_address_book_enabled', value: null },
        { key: 'nav_poi_finder_enabled', value: 'FALSE' },
      ]),
    ).toEqual(ALL_NAV_SHOWN)
  })
})
