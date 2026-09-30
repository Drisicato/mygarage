import { z } from 'zod'
import type { TFunction } from 'i18next'
import { makeOptionalCurrencySchema } from './shared'

/**
 * Factory, not a constant — see the header of schemas/auth.ts for why.
 *
 * Task 8 moved monthly_rate/electric/water/waste/total onto NumberInput/
 * registerDecimal, which can hand this schema the INVALID_NUMBER sentinel
 * for unparseable text — the old `.or(z.nan())` shape only recognized
 * number/NaN, so a sentinel failed the union and zod reported its raw
 * "expected number, received symbol" instead of a translated message.
 *
 * All five are money: the shared currency factory, floor 0 and the API's
 * MONEY_MAX, which the backend puts on every billing amount (money-fits).
 */
export const makeSpotRentalBillingSchema = (t: TFunction) =>
  z.object({
    billing_date: z.string().min(1, 'Billing date is required'),
    monthly_rate: makeOptionalCurrencySchema(t),
    electric: makeOptionalCurrencySchema(t),
    water: makeOptionalCurrencySchema(t),
    waste: makeOptionalCurrencySchema(t),
    total: makeOptionalCurrencySchema(t),
    notes: z.string().max(1000, 'Notes must be 1000 characters or less').optional(),
  })

export type SpotRentalBillingFormData = z.output<ReturnType<typeof makeSpotRentalBillingSchema>>
