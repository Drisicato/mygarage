import { describe, it, expect } from 'vitest'
import { makeSpotRentalBillingSchema } from '../spotRentalBilling'
import { INVALID_NUMBER, MONEY_MAX } from '../shared'

const t = ((key: string) => key) as unknown as Parameters<typeof makeSpotRentalBillingSchema>[0]
const spotRentalBillingSchema = makeSpotRentalBillingSchema(t)

describe('Spot Rental Billing Schema', () => {
  const validBilling = {
    billing_date: '2024-08-01',
  }

  it('validates valid billing with required fields only', () => {
    const result = spotRentalBillingSchema.safeParse(validBilling)
    expect(result.success).toBe(true)
  })

  it('validates billing with all optional fields', () => {
    const result = spotRentalBillingSchema.safeParse({
      ...validBilling,
      monthly_rate: 800.00,
      electric: 45.50,
      water: 12.00,
      waste: 20.00,
      total: 877.50,
      notes: 'August billing cycle',
    })
    expect(result.success).toBe(true)
  })

  it('requires billing_date', () => {
    const result = spotRentalBillingSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects negative monthly_rate', () => {
    const result = spotRentalBillingSchema.safeParse({
      ...validBilling,
      monthly_rate: -100,
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative utility costs', () => {
    const result = spotRentalBillingSchema.safeParse({
      ...validBilling,
      electric: -10,
    })
    expect(result.success).toBe(false)
  })

  // Task 8b: these now route through the shared makeNumericField, which
  // rejects NaN as invalid rather than treating it as empty — see
  // shared.test.ts.
  it('rejects NaN values as invalid rather than silently discarding them', () => {
    const result = spotRentalBillingSchema.safeParse({
      ...validBilling,
      monthly_rate: NaN,
    })
    expect(result.success).toBe(false)
  })

  // 250,000 is past the old 99,999.99 currency cap, and a month of HUF rent
  // gets there. The cap is the API's MONEY_MAX now, the same one the backend
  // puts on every billing amount (money-fits).
  it('accepts a monthly_rate past the old 99,999.99 cap', () => {
    const result = spotRentalBillingSchema.safeParse({
      ...validBilling,
      monthly_rate: 250_000,
    })
    expect(result.success).toBe(true)
  })

  it('refuses a cent past MONEY_MAX on every billing amount', () => {
    for (const field of ['monthly_rate', 'electric', 'water', 'waste', 'total']) {
      expect(spotRentalBillingSchema.safeParse({ ...validBilling, [field]: MONEY_MAX }).success).toBe(true)
      const result = spotRentalBillingSchema.safeParse({ ...validBilling, [field]: MONEY_MAX + 0.01 })
      expect(result.success, field).toBe(false)
      if (!result.success) expect(result.error.issues[0].message).toBe('common:validation.amount.tooLarge')
    }
  })

  // Final-review I6: `total` had `.nonnegative()` before Task 8, same as its
  // four siblings (`git show a920cbc:frontend/src/schemas/spotRentalBilling.ts`).
  // It lost its floor and got it back.
  it('accepts a total past the old 99,999.99 cap but rejects a negative one (the floor is real)', () => {
    expect(spotRentalBillingSchema.safeParse({ ...validBilling, total: 250_000 }).success).toBe(true)
    const result = spotRentalBillingSchema.safeParse({ ...validBilling, total: -50 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('common:validation.amount.negative')
    }
  })

  it('rejects notes over 1000 characters', () => {
    const result = spotRentalBillingSchema.safeParse({
      ...validBilling,
      notes: 'A'.repeat(1001),
    })
    expect(result.success).toBe(false)
  })

  // Regression for the CRITICAL finding: the pre-refactor `.or(z.nan())`
  // shape couldn't recognize INVALID_NUMBER (the sentinel registerDecimal
  // emits for unparseable text) and leaked zod's raw "Invalid input:
  // expected number, received symbol" instead of a translated message.
  it('rejects the INVALID_NUMBER sentinel on every currency field with the translated message, not a raw zod union error', () => {
    const result = spotRentalBillingSchema.safeParse({
      ...validBilling,
      monthly_rate: INVALID_NUMBER,
      electric: INVALID_NUMBER,
      water: INVALID_NUMBER,
      waste: INVALID_NUMBER,
      total: INVALID_NUMBER,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message)
      expect(messages.every(m => m === 'common:validation.amount.invalid')).toBe(true)
      expect(messages.length).toBe(5)
    }
  })
})
