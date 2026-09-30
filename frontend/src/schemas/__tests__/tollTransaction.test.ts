import { describe, it, expect } from 'vitest'
import { makeTollTransactionSchema } from '../tollTransaction'
import { INVALID_NUMBER } from '../shared'

const t = ((key: string) => key) as unknown as Parameters<typeof makeTollTransactionSchema>[0]
const tollTransactionSchema = makeTollTransactionSchema(t)

describe('Toll Transaction Schema', () => {
  const validTransaction = {
    transaction_date: '2024-03-15',
    amount: 2.25,
    location: 'Hardy Toll Road - Main Plaza',
  }

  it('requires the amount', () => {
    const { amount: _omitted, ...withoutAmount } = validTransaction
    const result = tollTransactionSchema.safeParse(withoutAmount)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['amount'])
      expect(result.error.issues[0].message).toBe('common:validation.amount.required')
    }
  })

  it('validates valid transaction with required fields only', () => {
    const result = tollTransactionSchema.safeParse(validTransaction)
    expect(result.success).toBe(true)
  })

  it('validates transaction with all optional fields', () => {
    const result = tollTransactionSchema.safeParse({
      ...validTransaction,
      amount: 3.50,
      toll_tag_id: 42,
      notes: 'Regular commute',
    })
    expect(result.success).toBe(true)
  })

  it('requires transaction_date', () => {
    const result = tollTransactionSchema.safeParse({ location: 'Toll Plaza' })
    expect(result.success).toBe(false)
  })

  it('requires location', () => {
    const result = tollTransactionSchema.safeParse({ transaction_date: '2024-03-15' })
    expect(result.success).toBe(false)
  })

  it('rejects negative amount', () => {
    const result = tollTransactionSchema.safeParse({
      ...validTransaction,
      amount: -5.00,
    })
    expect(result.success).toBe(false)
  })

  // Task 8b: `amount` routes through the shared makeNumericField, which no
  // longer treats NaN as empty — it can now only arrive from a control that
  // failed to parse, never an empty one, so it's rejected as invalid instead
  // of silently discarded. `toll_tag_id` (below) is unaffected: it keeps its
  // own bespoke NaN-to-undefined transform since its <Select> stays on
  // valueAsNumber and never produces the INVALID_NUMBER sentinel.
  it('rejects NaN amount as invalid rather than silently discarding it', () => {
    const result = tollTransactionSchema.safeParse({
      ...validTransaction,
      amount: NaN,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('common:validation.amount.invalid')
    }
  })

  it('transforms NaN toll_tag_id to undefined', () => {
    const result = tollTransactionSchema.safeParse({
      ...validTransaction,
      toll_tag_id: NaN,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.toll_tag_id).toBeUndefined()
    }
  })

  // Task 8: `amount` moved onto NumberInput/registerDecimal, which can hand the
  // schema the INVALID_NUMBER sentinel for unparseable text (typing "abc") — the
  // old `z.number().or(z.nan())` shape only recognized number/NaN, so a sentinel
  // failed the whole union and zod reported its generic "expected number,
  // received symbol", leaking an implementation detail instead of a real message.
  it('rejects the INVALID_NUMBER sentinel with the translated amount-invalid message, not a raw zod union error', () => {
    const result = tollTransactionSchema.safeParse({
      ...validTransaction,
      amount: INVALID_NUMBER,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('common:validation.amount.invalid')
    }
  })

  // Final-review I5: makeOptionalCurrencySchema's 99,999.99 ceiling doesn't
  // exist on the backend (toll.py — `ge=0`, no `le`). A large toll amount
  // (e.g. an unusual bulk/commercial toll charge) must not be client-side
  // rejected when the API would accept it.
  it('accepts an amount above the old 99,999.99 currency-factory ceiling', () => {
    const result = tollTransactionSchema.safeParse({
      ...validTransaction,
      amount: 150000,
    })
    expect(result.success).toBe(true)
  })
})
