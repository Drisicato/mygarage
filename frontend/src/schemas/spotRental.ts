import { z } from 'zod'
import type { TFunction } from 'i18next'
import { makeDateSchema, makeNotesSchema, makeOptionalCurrencySchema } from './shared'

/**
 * Spot rental schema matching backend Pydantic validators.
 * See: backend/app/schemas/spot_rental.py
 *
 * CRITICAL: This schema fixes 8 missing isNaN validation bugs in SpotRentalForm
 *
 * Factory, not a constant — see the header of schemas/auth.ts for why.
 *
 * Every rate and utility is money, so each takes the shared currency factory
 * and the API's MONEY_MAX. The old three tiers (9,999.99 a night or a utility,
 * 99,999.99 a week, month or total) refused a ¥10,000 night, and their
 * messages named a dollar cap to users of any currency (money-fits).
 */

export const makeSpotRentalSchema = (t: TFunction) =>
  z.object({
    location_name: z
      .string()
      .max(100, t('common:validation.spotRental.locationNameTooLong'))
      .optional(),
    location_address: z.string().optional(),
    check_in_date: makeDateSchema(t),
    check_out_date: z.string().optional(),
    nightly_rate: makeOptionalCurrencySchema(t),
    weekly_rate: makeOptionalCurrencySchema(t),
    monthly_rate: makeOptionalCurrencySchema(t),
    electric: makeOptionalCurrencySchema(t),
    water: makeOptionalCurrencySchema(t),
    waste: makeOptionalCurrencySchema(t),
    total_cost: makeOptionalCurrencySchema(t),
    amenities: z.string().optional(),
    notes: makeNotesSchema(t).optional(),
  })

// Use z.output for Zod v4 compatibility with z.coerce fields
export type SpotRentalInput = z.input<ReturnType<typeof makeSpotRentalSchema>>
export type SpotRentalFormData = z.output<ReturnType<typeof makeSpotRentalSchema>>
