import { z } from 'zod'
import type { TFunction } from 'i18next'
import type { UnitSet } from '@/types/units'
import {
  checkUnitPriceCap,
  makeNumericField,
  makeOptionalCurrencySchema,
  makeOptionalPricePerUnitSchema,
} from './shared'

/**
 * Factory, not a constant — see the header of schemas/auth.ts for why.
 *
 * Task 8 moved propane_liters/tank_quantity/price_per_unit/cost onto
 * NumberInput/registerDecimal, which can hand this schema the INVALID_NUMBER
 * sentinel for unparseable text — the old `.or(z.nan())` shape only
 * recognized number/NaN, so a sentinel failed the union and zod reported its
 * raw "expected number, received symbol" instead of a translated message.
 * Routed through the shared makeNumericField. The volume and the tank count
 * never had an upper bound, so `max: Infinity` keeps "no ceiling" there. The
 * cost and the price are money and take the API's caps (money-fits): the
 * price in $/L, because this form always posts `per_volume`, so `units` is
 * the client's resolved set for that conversion.
 *
 * `tank_size_kg` stays on the old shape deliberately: its <Select> stays on
 * valueAsNumber and never produces the sentinel.
 */
export const makePropaneRecordSchema = (t: TFunction, units: UnitSet) =>
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
    price_per_unit: makeOptionalPricePerUnitSchema(t),
    cost: makeOptionalCurrencySchema(t),
    vendor: z.string().max(100).optional(),
    notes: z.string().max(1000).optional(),
  })
  // Both tank fields or neither, as the API requires. The message lands on
  // the empty one, so clearing the size alone doesn't blame the count.
  .superRefine((data, ctx) => {
    // typeof, not !== undefined: a count that failed to parse still holds the
    // INVALID_NUMBER sentinel here, and already has its own error.
    const hasSize = typeof data.tank_size_kg === 'number'
    const hasCount = typeof data.tank_quantity === 'number'

    if (hasSize === hasCount) return
    ctx.addIssue({
      code: 'custom',
      path: [hasSize ? 'tank_quantity' : 'tank_size_kg'],
      message: t('common:validation.tankPair.bothOrNeither'),
    })
  })
  .superRefine((data, ctx) => checkUnitPriceCap(t, ctx, data.price_per_unit, units, 'per_volume'))

export type PropaneRecordInput = z.input<ReturnType<typeof makePropaneRecordSchema>>
export type PropaneRecordFormData = z.output<ReturnType<typeof makePropaneRecordSchema>>
