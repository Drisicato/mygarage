import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import { makeFinancingRecordSchema } from '../financing'
import { MONEY_MAX } from '../shared'

// Messages come back as their i18n key, as in the global mock.
const t = ((key: string) => key) as unknown as TFunction

const schema = makeFinancingRecordSchema(t)
const valid = { date: '2026-09-01', category: 'loan_payment', amount: 450 }

describe('Financing Record Schema: the amount cap', () => {
  it('accepts a payment past the old 99,999.99 cap (about $300 in forint)', () => {
    expect(schema.safeParse({ ...valid, amount: 110_000 }).success).toBe(true)
  })

  it('accepts MONEY_MAX and refuses a cent more', () => {
    expect(schema.safeParse({ ...valid, amount: MONEY_MAX }).success).toBe(true)
    const over = schema.safeParse({ ...valid, amount: MONEY_MAX + 0.01 })
    expect(over.success).toBe(false)
    if (!over.success) expect(over.error.issues[0].message).toBe('common:validation.amount.tooLarge')
  })
})
