/**
 * Returns the user's preferred currency code and a locale-aware formatCurrency function.
 *
 * Sources (in priority order), skipping any code outside SUPPORTED_CURRENCIES:
 * 1. Authenticated user's currency_code from DB
 * 2. localStorage 'currency_code'
 * 3. Default: 'USD'
 */
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { languageToLocale, supportedCurrencyCode } from '../constants/i18n'
import {
  formatCurrency as formatCurrencyShared,
  type CurrencyFormatOptions,
} from '../utils/formatUtils'

/** The shared options minus the two this hook fills in, so the two can't drift. */
type PreferenceFormatOptions = Omit<CurrencyFormatOptions, 'currencyCode' | 'locale'>

interface CurrencyPreference {
  currencyCode: string
  locale: string
  formatCurrency: (
    value: number | string | null | undefined,
    options?: PreferenceFormatOptions
  ) => string
}

/** The stored code, or null. Blocked storage throws on read, and this runs on every page. */
function storedCurrencyCode(): string | null {
  try {
    return localStorage.getItem('currency_code')
  } catch {
    return null
  }
}

export function useCurrencyPreference(): CurrencyPreference {
  const { user } = useAuth()
  const { i18n } = useTranslation()

  const currencyCode =
    supportedCurrencyCode(user?.currency_code) ?? supportedCurrencyCode(storedCurrencyCode()) ?? 'USD'
  const locale = languageToLocale(i18n.language)

  const formatCurrency = useCallback(
    (
      value: number | string | null | undefined,
      options: PreferenceFormatOptions = {}
    ): string => formatCurrencyShared(value, { ...options, currencyCode, locale }),
    [currencyCode, locale]
  )

  return { currencyCode, locale, formatCurrency }
}
