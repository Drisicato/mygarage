/**
 * Household switches that hide a top-level nav tab (Settings > System >
 * Garage sections). They're public settings so every client, including an
 * `auth_mode=none` one with no user, reads them at boot.
 *
 * A tab is shown unless its row says exactly "false": a missing row (an
 * instance from before the switch, or a failed fetch) must never make a tab
 * disappear.
 */

import type { PublicSetting } from './publicUnitDefaults'

export const NAV_TOGGLE_KEYS = ['nav_address_book_enabled', 'nav_poi_finder_enabled'] as const

export type NavToggleKey = (typeof NAV_TOGGLE_KEYS)[number]
export type NavToggles = Record<NavToggleKey, boolean>

export const ALL_NAV_SHOWN: NavToggles = {
  nav_address_book_enabled: true,
  nav_poi_finder_enabled: true,
}

export function readNavToggles(settings: readonly PublicSetting[]): NavToggles {
  const toggles = { ...ALL_NAV_SHOWN }
  for (const key of NAV_TOGGLE_KEYS) {
    toggles[key] = settings.find((s) => s.key === key)?.value !== 'false'
  }
  return toggles
}
