/**
 * Shared formatting utilities for currency and numbers.
 */

import { CURRENCY_DIGITS, cachedCurrencyFormat } from './numberFormatCache'

const GENERIC_CURRENCY_SIGN = '¤'

/**
 * Fraction digits for a money rate: a unit price, an average unit cost, a cost
 * per hour. A rate keeps its decimals in every currency, so ¥170.5/L never
 * reads ¥171. Two is what these showed before plain amounts took the
 * currency's own digits, and what the cost-per-volume and cost-per-distance
 * cards use.
 */
export const RATE_DIGITS = 2

/**
 * Options for `formatCurrency`. `currencyCode` is required so a direct call
 * can't quietly render dollars; `useCurrencyPreference` fills it in for you.
 */
export interface CurrencyFormatOptions {
  /** Returned when the value is null, undefined, unparseable or zero (default: '-'). */
  fallback?: string
  /** Hide the fraction digits entirely (default: false). */
  wholeDollars?: boolean
  /**
   * Show exactly this many fraction digits instead of the currency's own. For
   * rates (pass `RATE_DIGITS`); a plain amount leaves it unset. Wins over
   * `wholeDollars`.
   */
  fractionDigits?: number
  /** Format 0 instead of returning the fallback (default: false). */
  zeroIsValid?: boolean
  /** ISO 4217 code. */
  currencyCode: string
  /** BCP 47 locale for number formatting (default: 'en-US'). */
  locale?: string
}

/**
 * Build the Intl-formatted currency string, swapping the generic ¤ sign for
 * the code and falling back to `<CODE> <value>` if Intl throws.
 */
function formatWithIntl(
  num: number,
  currencyCode: string,
  locale: string,
  digits: number | typeof CURRENCY_DIGITS
): string {
  try {
    // Inside the try, so an invalid currency code still throws where it always
    // did and still falls back below; the cache stores nothing on a throw, so a
    // bad code costs one construction per call exactly as before.
    const formatted = cachedCurrencyFormat(locale, currencyCode, digits).format(num)
    // Intl emits ¤ for ISO "no currency" codes (e.g. XXX). Swap for the code.
    if (formatted.includes(GENERIC_CURRENCY_SIGN)) {
      return formatted.replace(GENERIC_CURRENCY_SIGN, currencyCode)
    }
    return formatted
  } catch {
    // Intl doesn't know this code, so it can't tell us its digits either.
    return `${currencyCode} ${num.toFixed(digits === CURRENCY_DIGITS ? 2 : digits)}`
  }
}

/** The digits an options object asks for: explicit, none, or the currency's own. */
function digitsFor(
  options: Pick<CurrencyFormatOptions, 'fractionDigits' | 'wholeDollars'>
): number | typeof CURRENCY_DIGITS {
  if (options.fractionDigits !== undefined) return options.fractionDigits
  return options.wholeDollars ? 0 : CURRENCY_DIGITS
}

/**
 * Format a value as currency using Intl.NumberFormat.
 *
 * Handles number, string (parseable), null, and undefined inputs. A plain
 * amount takes the currency's own fraction digits (yen 0, dollars 2) unless
 * `wholeDollars` drops them; a rate passes `fractionDigits: RATE_DIGITS`.
 *
 * @param value - The value to format
 * @param options - Formatting options; see `CurrencyFormatOptions`
 * @returns Formatted currency string, or the fallback
 */
export function formatCurrency(
  value: number | string | null | undefined,
  options: CurrencyFormatOptions
): string {
  const { fallback = '-', zeroIsValid = false, currencyCode, locale = 'en-US' } = options

  if (value === null || value === undefined) return fallback

  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return fallback
  if (num === 0 && !zeroIsValid) return fallback

  return formatWithIntl(num, currencyCode, locale, digitsFor(options))
}

/**
 * Format currency with zero fallback for analytics views where zero costs are meaningful.
 */
export function formatCurrencyZero(
  value: number | string | null | undefined,
  options: Pick<CurrencyFormatOptions, 'currencyCode' | 'locale' | 'fractionDigits'>
): string {
  const { currencyCode, locale = 'en-US', fractionDigits } = options
  const zeroFormatted = formatWithIntl(0, currencyCode, locale, digitsFor(options))
  return formatCurrency(value, {
    fallback: zeroFormatted,
    zeroIsValid: true,
    currencyCode,
    locale,
    fractionDigits,
  })
}

/**
 * Format a raw window-sticker value (from the NHTSA/OCR options-detail map):
 * arrays join with commas, a purely-numeric string renders as currency
 * (including 0, since a $0 option is meaningful), anything else passes through
 * unchanged. Returns null for empty/absent values so callers can omit the field.
 */
export function formatStickerValue(
  raw: unknown,
  { currencyCode, locale }: Pick<CurrencyFormatOptions, 'currencyCode' | 'locale'>
): string | null {
  const text = Array.isArray(raw) ? raw.join(', ') : typeof raw === 'string' ? raw : null
  if (!text) return null
  return /^\d+(\.\d+)?$/.test(text)
    ? formatCurrency(text, { currencyCode, locale, zeroIsValid: true })
    : text
}
