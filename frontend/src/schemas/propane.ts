import { z } from 'zod'
import type { TFunction } from 'i18next'
import { makeNumericField } from './shared'

/**
 * Factory, not a constant — see the header of schemas/auth.ts for why.
 *
 * Task 8 moved propane_liters/tank_quantity/price_per_unit/cost onto
 * NumberInput/registerDecimal, which can hand this schema the INVALID_NUMBER
 * sentinel for unparseable text — the old `.or(z.nan())` shape only
 * recognized number/NaN, so a sentinel failed the union and zod reported its
 * raw "expected number, received symbol" instead of a translated message.
 * Routed through the shared makeNumericField, preserving each field's exact
 * original bound (none of these had an upper bound, so `max: Infinity`
 * reproduces "no ceiling" rather than inventing one).
 *
 * `tank_size_kg` stays on the old shape deliberately: its <Select> stays on
 * valueAsNumber and never produces the sentinel.
 */
export const makePropaneRecordSchema = (t: TFunction) =>
  z.object({
    date: z.string().min(1, 'Date is required'),
    propane_liters: makeNumericField(t, {
      min: 0,
      max: Infinity,
      exclusiveMin: true, // was .positive() — must be > 0, not just >= 0
      negativeKey: 'common:validation.volume.negative',
      tooLargeKey: 'common:validation.volume.tooLarge',
      invalidKey: 'common:validation.volume.invalid',
    }),
    tank_size_kg: z
      .number()
      .positive('Tank size must be greater than 0')
      .or(z.nan())
      .transform(val => isNaN(val) ? undefined : val)
      .optional(),
    tank_quantity: makeNumericField(t, {
      min: 0,
      max: Infinity,
      exclusiveMin: true, // was .positive()
      negativeKey: 'common:validation.tankQuantity.negative',
      tooLargeKey: 'common:validation.tankQuantity.tooLarge',
      invalidKey: 'common:validation.tankQuantity.invalid',
      integerKey: 'common:validation.tankQuantity.notWhole',
    }),
    price_per_unit: makeNumericField(t, {
      min: 0,
      max: Infinity,
      negativeKey: 'common:validation.price.negative',
      tooLargeKey: 'common:validation.price.tooLarge',
      invalidKey: 'common:validation.price.invalid',
    }),
    cost: makeNumericField(t, {
      min: 0,
      max: Infinity,
      negativeKey: 'common:validation.amount.negative',
      tooLargeKey: 'common:validation.amount.tooLarge',
      invalidKey: 'common:validation.amount.invalid',
    }),
    vendor: z.string().max(100).optional(),
    notes: z.string().max(1000).optional(),
  })
  // Both tank fields or neither, as the API requires. The message lands on
  // the empty one, so clearing the size alone doesn't blame the count.
  .superRefine((data, ctx) => {
    const hasSize = data.tank_size_kg !== undefined
    const hasCount = data.tank_quantity !== undefined
    if (hasSize === hasCount) return
    ctx.addIssue({
      code: 'custom',
      path: [hasSize ? 'tank_quantity' : 'tank_size_kg'],
      message: t('common:validation.tankPair.bothOrNeither'),
    })
  })

export type PropaneRecordInput = z.input<ReturnType<typeof makePropaneRecordSchema>>
export type PropaneRecordFormData = z.output<ReturnType<typeof makePropaneRecordSchema>>
