/**
 * The frontend's currency list is the backend's allowlist, read from the
 * backend source rather than retyped.
 *
 * A code only one side knows is either offered in Settings and refused with a
 * 422, or accepted by the API and then clamped back to USD by
 * useCurrencyPreference.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { SUPPORTED_CURRENCIES } from '../i18n'

const backendSource = readFileSync(
  resolve(__dirname, '../../../../backend/app/constants/i18n.py'),
  'utf-8',
)

/** The quoted codes in the backend's `SUPPORTED_CURRENCIES: set[str] = {...}`. */
function backendCurrencies(): Set<string> {
  // Throws instead of matching nothing, so a reshaped declaration can't pass
  // by comparing two empty sets.
  const body = /^SUPPORTED_CURRENCIES: set\[str\] = \{([^}]*)\}/m.exec(backendSource)?.[1]
  if (body === undefined) {
    throw new Error('SUPPORTED_CURRENCIES: set[str] = {...} not found in backend/app/constants/i18n.py')
  }
  return new Set([...body.matchAll(/"([^"]*)"/g)].map((match) => match[1]))
}

describe('currencies: the frontend list is the backend allowlist', () => {
  it('holds exactly the codes the backend accepts', () => {
    // Guard: the two lists match today. Mutant that kills it: add
    // { code: 'KRW', name: 'South Korean Won' } to the frontend list.
    const theirs = backendCurrencies()
    // A floor, so a regex that stops catching quotes can't compare two empties.
    expect(theirs.size).toBeGreaterThanOrEqual(10)
    expect(SUPPORTED_CURRENCIES.map((currency) => currency.code).sort()).toEqual([...theirs].sort())
  })
})
