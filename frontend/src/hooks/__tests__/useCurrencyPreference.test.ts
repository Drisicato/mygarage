/**
 * The hook hands out a code the backend accepts, whatever the row or the
 * browser holds.
 *
 * Every cost card (fuel, DEF, propane, analytics) gets its code from here, and
 * two of their formatters call Intl with no try/catch, so a code Intl rejects
 * took the card down with a RangeError. Clamping here covers all of them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { METRIC_UNITS } from '@/__tests__/factories'
import { SUPPORTED_CURRENCIES } from '../../constants/i18n'
import { UnitFormatter } from '../../utils/units'

const h = vi.hoisted(() => ({ user: null as { currency_code?: string | null } | null }))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: h.user, isAuthenticated: h.user !== null }),
}))

import { useCurrencyPreference } from '../useCurrencyPreference'

const allowlisted = SUPPORTED_CURRENCIES.map((currency) => currency.code)

describe('useCurrencyPreference: only a supported code comes out', () => {
  beforeEach(() => {
    localStorage.clear()
    h.user = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a currency code the backend never accepts falls back to USD', () => {
    h.user = { currency_code: 'BADX' }

    const { result } = renderHook(() => useCurrencyPreference())

    expect(result.current.currencyCode).toBe('USD')
  })

  it('a bad stored code falls back to USD', () => {
    localStorage.setItem('currency_code', 'XYZ1')

    const { result } = renderHook(() => useCurrencyPreference())

    expect(result.current.currencyCode).toBe('USD')
  })

  it('a bad account code falls back to a good stored one', () => {
    h.user = { currency_code: 'BADX' }
    localStorage.setItem('currency_code', 'PLN')

    const { result } = renderHook(() => useCurrencyPreference())

    expect(result.current.currencyCode).toBe('PLN')
  })

  it('the cost cards format with the code it returns', () => {
    h.user = { currency_code: 'BADX' }

    const { result } = renderHook(() => useCurrencyPreference())

    // formatCostPerVolume has no try/catch of its own, so this is the crash.
    expect(() =>
      UnitFormatter.formatCostPerVolume(1.5, METRIC_UNITS, result.current.currencyCode),
    ).not.toThrow()
  })

  it('blocked storage that throws on read still gives an allowlisted code', () => {
    // A browser with site data blocked throws on any localStorage read, and
    // this hook runs on every page.
    h.user = { currency_code: 'BADX' }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })

    const { result } = renderHook(() => useCurrencyPreference())

    expect(result.current.currencyCode).toBe('USD')
    expect(allowlisted).toContain(result.current.currencyCode)
  })

  it('a supported account code comes through unchanged', () => {
    // Guard: passes before the fix too, since the old hook passed everything
    // through. Mutant that kills it: the hook always returns 'USD'.
    h.user = { currency_code: 'EUR' }
    localStorage.setItem('currency_code', 'PLN')

    const { result } = renderHook(() => useCurrencyPreference())

    expect(result.current.currencyCode).toBe('EUR')
  })
})
