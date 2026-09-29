import { describe, it, expect } from 'vitest'
import { makePropaneRecordSchema } from '../propane'
import { INVALID_NUMBER } from '../shared'

const t = ((key: string) => key) as unknown as Parameters<typeof makePropaneRecordSchema>[0]
const propaneRecordSchema = makePropaneRecordSchema(t)

describe('Propane Record Schema', () => {
  const validPropane = {
    date: '2024-09-15',
  }

  it('validates valid propane record with required fields only', () => {
    const result = propaneRecordSchema.safeParse(validPropane)
    expect(result.success).toBe(true)
  })

  it('validates propane record with all optional fields', () => {
    const result = propaneRecordSchema.safeParse({
      ...validPropane,
      propane_liters: 7.5,
      tank_size_kg: 30,
      tank_quantity: 2,
      price_per_unit: 4.50,
      cost: 33.75,
      vendor: 'U-Haul',
      notes: 'Refilled both 30lb tanks',
    })
    expect(result.success).toBe(true)
  })

  it('requires date', () => {
    const result = propaneRecordSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects non-positive propane_liters', () => {
    const result = propaneRecordSchema.safeParse({
      ...validPropane,
      propane_liters: 0,
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-integer tank_quantity', () => {
    const result = propaneRecordSchema.safeParse({
      ...validPropane,
      tank_quantity: 1.5,
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative cost', () => {
    const result = propaneRecordSchema.safeParse({
      ...validPropane,
      cost: -10,
    })
    expect(result.success).toBe(false)
  })

  // tank_size_kg stays on the old .or(z.nan()) shape (its <Select> stays on
  // valueAsNumber and never produces INVALID_NUMBER), so NaN still transforms
  // to undefined there. propane_liters/cost now route through the shared
  // makeNumericField (post-Task-8b), which rejects NaN as invalid rather
  // than treating it as empty — see shared.test.ts.
  it('transforms NaN tank_size_kg to undefined (bespoke Select-backed field, unaffected by Task 8/8b)', () => {
    const result = propaneRecordSchema.safeParse({
      ...validPropane,
      tank_size_kg: NaN,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tank_size_kg).toBeUndefined()
    }
  })

  it('rejects NaN propane_liters/cost as invalid rather than silently discarding them', () => {
    const result = propaneRecordSchema.safeParse({
      ...validPropane,
      propane_liters: NaN,
      cost: NaN,
    })
    expect(result.success).toBe(false)
  })

  it('rejects vendor over 100 characters', () => {
    const result = propaneRecordSchema.safeParse({
      ...validPropane,
      vendor: 'A'.repeat(101),
    })
    expect(result.success).toBe(false)
  })

  // Regression for the CRITICAL finding: the pre-refactor `.or(z.nan())`
  // shape these fields used to have couldn't recognize INVALID_NUMBER (the
  // sentinel registerDecimal emits for unparseable text) and leaked zod's
  // raw "Invalid input: expected number, received symbol" instead of a
  // translated message. Assert each converted field now reports one.
  it('rejects the INVALID_NUMBER sentinel with translated messages, not a raw zod union error', () => {
    const result = propaneRecordSchema.safeParse({
      ...validPropane,
      propane_liters: INVALID_NUMBER,
      tank_quantity: INVALID_NUMBER,
      price_per_unit: INVALID_NUMBER,
      cost: INVALID_NUMBER,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message)
      expect(messages).toContain('common:validation.volume.invalid')
      expect(messages).toContain('common:validation.tankQuantity.invalid')
      expect(messages).toContain('common:validation.price.invalid')
      expect(messages).toContain('common:validation.amount.invalid')
      for (const m of messages) {
        expect(m).not.toMatch(/received symbol|expected number/i)
      }
    }
  })
})

describe('Propane Record Schema: the tank pair', () => {
  // The API refuses a tank size without a count, or a count without a size.
  const base = { date: '2024-09-15', propane_liters: 7.5 }
  const issuesAt = (input: Record<string, unknown>) => {
    const result = propaneRecordSchema.safeParse({ ...base, ...input })
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
  }

  it('a size without a count flags the count', () => {
    expect(issuesAt({ tank_size_kg: 9.07 })).toEqual(['tank_quantity'])
  })

  it('a count without a size flags the size', () => {
    expect(issuesAt({ tank_quantity: 2 })).toEqual(['tank_size_kg'])
  })

  it('both or neither is fine', () => {
    expect(issuesAt({ tank_size_kg: 9.07, tank_quantity: 2 })).toEqual([])
    expect(issuesAt({})).toEqual([])
  })
})
