import { describe, expect, it } from 'vitest'
import { makeUnitSet } from '@/__tests__/factories'
import { formatCurrency, formatCurrencyZero, formatStickerValue } from '../formatUtils'
import { formatCostPerDistance } from '../unitFormat'
import { UnitFormatter } from '../units'

describe('an amount takes its currency\'s own digits', () => {
  it('shows yen as whole yen', () => {
    expect(formatCurrency(17500, { currencyCode: 'JPY', locale: 'en-US' })).toBe('¥17,500')
  })

  it('keeps dollars at two decimals', () => {
    expect(formatCurrency(17.5, { currencyCode: 'USD', locale: 'en-US' })).toBe('$17.50')
  })

  it('zero-fills in the currency\'s own digits too', () => {
    expect(formatCurrencyZero(null, { currencyCode: 'JPY', locale: 'en-US' })).toBe('¥0')
    expect(formatCurrencyZero(null, { currencyCode: 'USD', locale: 'en-US' })).toBe('$0.00')
  })

  it('still drops the cents under wholeDollars', () => {
    expect(formatCurrency(1234.56, { currencyCode: 'USD', locale: 'en-US', wholeDollars: true })).toBe('$1,235')
    expect(formatCurrency(17500, { currencyCode: 'JPY', locale: 'en-US', wholeDollars: true })).toBe('¥17,500')
  })

  it('keeps a rate\'s explicit decimals, even in yen', () => {
    // Rates ask for their precision on purpose, and they share the formatter
    // cache with plain amounts. Format a plain yen amount on both sides so a
    // cache key that forgot the digits mode would hand one the other's output.
    const metric = makeUnitSet()
    expect(formatCurrency(17500, { currencyCode: 'JPY', locale: 'en-US' })).toBe('¥17,500')
    expect(formatCostPerDistance(metric, 0.1, 'JPY', 'en-US')).toBe('¥10.00')
    expect(UnitFormatter.formatCostPerVolume(170.5, metric, 'JPY', 'en-US')).toBe('¥170.50')
    expect(formatCurrency(17500, { currencyCode: 'JPY', locale: 'en-US' })).toBe('¥17,500')
  })
})

describe('a rate asks for its digits and keeps them', () => {
  // A unit price or a cost per hour is a rate: ¥170.5/L rounded to the yen's
  // own zero digits would read ¥171 and no longer match what was entered.
  it('shows a yen unit price with its decimals', () => {
    expect(formatCurrency(170.5, { currencyCode: 'JPY', locale: 'en-US', fractionDigits: 2 })).toBe('¥170.50')
  })

  it('leaves a dollar rate where it was', () => {
    expect(formatCurrency(3.459, { currencyCode: 'USD', locale: 'en-US', fractionDigits: 2 })).toBe('$3.46')
  })

  it('zero-fills a rate at its own digits', () => {
    expect(formatCurrencyZero(null, { currencyCode: 'JPY', locale: 'en-US', fractionDigits: 2 })).toBe('¥0.00')
    expect(formatCurrencyZero(170.5, { currencyCode: 'JPY', locale: 'en-US', fractionDigits: 2 })).toBe('¥170.50')
  })

  it('beats wholeDollars when both are given', () => {
    expect(formatCurrency(170.5, { currencyCode: 'JPY', locale: 'en-US', fractionDigits: 2, wholeDollars: true })).toBe('¥170.50')
  })

  it('keeps its digits when Intl rejects the code', () => {
    expect(formatCurrency(170.5, { currencyCode: 'BADX', fractionDigits: 3 })).toBe('BADX 170.500')
  })

  it('does not leak into a plain yen amount formatted next to it', () => {
    expect(formatCurrency(170.5, { currencyCode: 'JPY', locale: 'en-US', fractionDigits: 2 })).toBe('¥170.50')
    expect(formatCurrency(17500, { currencyCode: 'JPY', locale: 'en-US' })).toBe('¥17,500')
    expect(formatCurrency(170.5, { currencyCode: 'JPY', locale: 'en-US' })).toBe('¥171')
  })
})

// Never called. tsc reads it, and each directive fails the type-check if the
// call it sits on ever compiles again, so a direct call can't quietly be USD.
export function currencyIsRequired(): void {
  // @ts-expect-error currencyCode is required
  formatCurrency(1)
  // @ts-expect-error currencyCode is required
  formatCurrency(1, { locale: 'en-US' })
  // @ts-expect-error currencyCode is required
  formatCurrencyZero(1)
  // @ts-expect-error currencyCode is required
  formatStickerValue('1')
  // @ts-expect-error currencyCode is required
  formatCostPerDistance(makeUnitSet(), 0.1)
  // @ts-expect-error currencyCode is required
  UnitFormatter.formatCostPerVolume(1, makeUnitSet())
}

describe('formatCurrency', () => {
  it('formats USD values with default locale', () => {
    expect(formatCurrency(42, { currencyCode: 'USD' })).toContain('$')
    expect(formatCurrency(42, { currencyCode: 'USD' })).toContain('42.00')
  })

  it('formats EUR under en-US with the € symbol', () => {
    const out = formatCurrency(42, { currencyCode: 'EUR' })
    expect(out).toContain('€')
  })

  it('returns fallback for null / undefined / 0 by default', () => {
    expect(formatCurrency(null, { currencyCode: 'USD' })).toBe('-')
    expect(formatCurrency(undefined, { currencyCode: 'USD' })).toBe('-')
    expect(formatCurrency(0, { currencyCode: 'USD' })).toBe('-')
  })

  it('formats 0 when zeroIsValid is true', () => {
    const out = formatCurrency(0, { currencyCode: 'USD', zeroIsValid: true })
    expect(out).toContain('$')
    expect(out).toContain('0.00')
  })

  it('handles whole-dollar formatting', () => {
    const out = formatCurrency(1234.56, { currencyCode: 'USD', wholeDollars: true })
    // whole-dollar mode drops the cents
    expect(out).toContain('$')
    expect(out).not.toContain('.')
  })

  it('swaps ¤ for the currency code when Intl silently emits the generic sign (XXX)', () => {
    const out = formatCurrency(42, { currencyCode: 'XXX' })
    expect(out).not.toContain('¤')
    expect(out).toContain('XXX')
  })

  it('falls back to code-prefixed decimal when Intl throws on a hard-invalid code', () => {
    const out = formatCurrency(42, { currencyCode: 'BADX' })
    expect(out).toContain('BADX')
    expect(out).toContain('42.00')
    expect(out).not.toContain('¤')
    expect(out).not.toContain('$')
  })

  it('returns fallback when input string is not parseable', () => {
    expect(formatCurrency('not-a-number', { currencyCode: 'USD' })).toBe('-')
  })
})

describe('formatCurrencyZero', () => {
  it('falls back to zero-formatted value when input is null', () => {
    const zero = formatCurrencyZero(null, { currencyCode: 'USD' })
    expect(zero).toContain('$')
    expect(zero).toContain('0.00')
  })

  it('uses the correct currency symbol for non-USD', () => {
    const out = formatCurrencyZero(null, { currencyCode: 'EUR' })
    expect(out).toContain('€')
  })

  it('never leaks ¤ for XXX', () => {
    const out = formatCurrencyZero(null, { currencyCode: 'XXX' })
    expect(out).not.toContain('¤')
  })

  it('falls back cleanly on a hard-invalid code', () => {
    const out = formatCurrencyZero(null, { currencyCode: 'BADX' })
    expect(out).toContain('BADX')
    expect(out).not.toContain('¤')
  })
})
