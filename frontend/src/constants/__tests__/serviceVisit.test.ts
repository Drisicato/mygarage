import { describe, it, expect } from 'vitest'
import vehiclesEn from '../../locales/en/vehicles.json'
import { INSPECTION_RESULT_KEYS, INSPECTION_RESULT_FALLBACK_KEY } from '../serviceVisit'

// validate-i18n-usage can't follow an indexed map, so this is the check that
// a renamed key here doesn't ship as the raw key.
const resolve = (key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], vehiclesEn)

describe('service visit inspection result keys', () => {
  it('every key resolves to an English string', () => {
    for (const key of [...Object.values(INSPECTION_RESULT_KEYS), INSPECTION_RESULT_FALLBACK_KEY]) {
      expect(typeof resolve(key), key).toBe('string')
    }
  })
})
