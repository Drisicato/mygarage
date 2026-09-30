import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import type { TFunction } from 'i18next'
import { makeVehicleEditSchema, VEHICLE_TYPES } from '../vehicle'
import { INVALID_NUMBER, MONEY_MAX } from '../shared'

// Same shape as the global react-i18next mock in src/__tests__/setup.ts:
// messages come back as their i18n key, which is all these tests need.
const t = ((key: string) => key) as unknown as TFunction
const vehicleEditSchema = makeVehicleEditSchema(t)

// Mock vehicle schema based on typical structure
const vehicleSchema = z.object({
  vin: z.string().length(17, 'VIN must be 17 characters'),
  year: z.number().int().min(1900).max(new Date().getFullYear() + 1),
  make: z.string().min(1, 'Make is required'),
  model: z.string().min(1, 'Model is required'),
  trim: z.string().optional(),
  nickname: z.string().optional(),
  license_plate: z.string().optional(),
  current_odometer: z.number().int().min(0).optional(),
  purchase_date: z.string().optional(),
  purchase_price: z.number().min(0).optional(),
})

describe('Vehicle Schema', () => {
  it('validates valid vehicle object', () => {
    const validVehicle = {
      vin: '1HGBH41JXMN109186',
      year: 2018,
      make: 'Honda',
      model: 'Accord',
    }

    const result = vehicleSchema.safeParse(validVehicle)
    expect(result.success).toBe(true)
  })

  it('requires 17-character VIN', () => {
    const invalidVehicle = {
      vin: 'SHORT',
      year: 2018,
      make: 'Honda',
      model: 'Accord',
    }

    const result = vehicleSchema.safeParse(invalidVehicle)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('17 characters')
    }
  })

  it('requires make and model', () => {
    const invalidVehicle = {
      vin: '1HGBH41JXMN109186',
      year: 2018,
      make: '',
      model: '',
    }

    const result = vehicleSchema.safeParse(invalidVehicle)
    expect(result.success).toBe(false)
  })

  it('validates year range', () => {
    const invalidVehicle = {
      vin: '1HGBH41JXMN109186',
      year: 1800, // Too old
      make: 'Honda',
      model: 'Accord',
    }

    const result = vehicleSchema.safeParse(invalidVehicle)
    expect(result.success).toBe(false)
  })

  it('validates positive odometer', () => {
    const invalidVehicle = {
      vin: '1HGBH41JXMN109186',
      year: 2018,
      make: 'Honda',
      model: 'Accord',
      current_odometer: -100, // Negative
    }

    const result = vehicleSchema.safeParse(invalidVehicle)
    expect(result.success).toBe(false)
  })

  it('allows optional fields', () => {
    const validVehicle = {
      vin: '1HGBH41JXMN109186',
      year: 2018,
      make: 'Honda',
      model: 'Accord',
      // trim, nickname, etc. are optional
    }

    const result = vehicleSchema.safeParse(validVehicle)
    expect(result.success).toBe(true)
  })
})

// nickname and vehicle_type are NOT NULL columns in the DB — they are
// required on the edit schema (a null would raise IntegrityError server-side
// and roll back the whole update), so every parse of the real schema needs
// them present and non-blank.
const base = { nickname: 'Test Vehicle', vehicle_type: 'Car' } as const

// Task 3 (frontend fuel-type hardening): the real vehicleEditSchema used by
// VehicleWizard/VehicleEdit. fuel_type must transform blank/null input to an
// explicit `null` when the key is actually present in the submitted object
// — the vehicle update endpoint uses Pydantic's `model_dump(exclude_unset=
// True)`, so a present `null` key clears the column, while an `undefined`
// key gets dropped by JSON.stringify and the backend treats it as
// "unchanged". An omitted key must stay `undefined` (see the dedicated test
// below) — a non-motorized vehicle without an existing fuel_type never
// registers the field, and this schema must not force-clear it.
describe('vehicleEditSchema — fuel_type null-vs-undefined', () => {
  it('passes through a valid canonical fuel_type value unchanged', () => {
    const result = vehicleEditSchema.parse({ ...base, fuel_type: 'diesel' })
    expect(result.fuel_type).toBe('diesel')
  })

  it('transforms the empty-option selection ("") to null', () => {
    const result = vehicleEditSchema.parse({ ...base, fuel_type: '' })
    expect(result.fuel_type).toBeNull()
  })

  it('leaves an omitted fuel_type as undefined (not an explicit null)', () => {
    // `.optional()` composes outside the transform, so an omitted key
    // short-circuits to `undefined` instead of the transform synthesizing an
    // explicit `null` — JSON.stringify drops `undefined`, which is what lets
    // an unregistered field skip the update payload instead of clearing the
    // column server-side.
    const result = vehicleEditSchema.parse({ ...base })
    expect(result.fuel_type).toBeUndefined()
  })

  it('transforms a null fuel_type (as loaded from an unset vehicle record) to null', () => {
    const result = vehicleEditSchema.parse({ ...base, fuel_type: null })
    expect(result.fuel_type).toBeNull()
  })

  it('serializes to a `"fuel_type":null` key, unlike undefined which JSON.stringify drops', () => {
    const result = vehicleEditSchema.parse({ ...base, fuel_type: '' })
    const roundTripped = JSON.parse(JSON.stringify(result))
    expect(roundTripped).toHaveProperty('fuel_type', null)
  })
})

// Task 19 round 2 (Critical fix): nickname and vehicle_type are NOT NULL DB
// columns (`mapped_column(..., nullable=False)`). The generic null-on-clear
// transform must NOT apply to them — submitting explicit `null` raises an
// IntegrityError on the backend, 409s, and rolls back every other edited
// field. They are required non-blank on the edit schema instead, mirroring
// their required-on-create status.
describe('vehicleEditSchema — nickname/vehicle_type required (NOT NULL columns)', () => {
  it('rejects a blanked-out nickname ("") instead of transforming it to null', () => {
    const result = vehicleEditSchema.safeParse({ ...base, nickname: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a whitespace-only nickname', () => {
    const result = vehicleEditSchema.safeParse({ ...base, nickname: '   ' })
    expect(result.success).toBe(false)
  })

  it('rejects an omitted nickname', () => {
    const result = vehicleEditSchema.safeParse({ vehicle_type: 'Car' })
    expect(result.success).toBe(false)
  })

  it('rejects a null nickname', () => {
    const result = vehicleEditSchema.safeParse({ ...base, nickname: null })
    expect(result.success).toBe(false)
  })

  it('trims surrounding whitespace from a valid nickname', () => {
    const result = vehicleEditSchema.parse({ ...base, nickname: '  My Truck  ' })
    expect(result.nickname).toBe('My Truck')
  })

  it('passes through a set nickname unchanged', () => {
    const result = vehicleEditSchema.parse({ ...base, nickname: 'My Truck' })
    expect(result.nickname).toBe('My Truck')
  })

  it('rejects a blanked-out vehicle_type ("")', () => {
    const result = vehicleEditSchema.safeParse({ ...base, vehicle_type: '' })
    expect(result.success).toBe(false)
  })

  it('rejects an omitted vehicle_type', () => {
    const result = vehicleEditSchema.safeParse({ nickname: 'Test Vehicle' })
    expect(result.success).toBe(false)
  })

  it('accepts every canonical vehicle type', () => {
    for (const type of VEHICLE_TYPES) {
      const result = vehicleEditSchema.parse({ ...base, vehicle_type: type })
      expect(result.vehicle_type).toBe(type)
    }
  })
})

// Task 19 (fold-in fix): the same null-vs-undefined bug documented above for
// fuel_type also affects every other NULLABLE optional string field on this
// schema (trim, make, model, etc. — all backed by optionalStringSchema).
// Clearing a *present* field in the UI must submit an explicit `null`, not
// `undefined` (which JSON.stringify drops, and which the backend's
// `exclude_unset=True` partial update then reads as "leave unchanged"). An
// omitted key (field never registered on the form) must stay `undefined` —
// see the CRITICAL fix below and its dedicated describe block.
describe('vehicleEditSchema — nullable optional-string fields null-vs-undefined', () => {
  it('passes through a set trim unchanged', () => {
    const result = vehicleEditSchema.parse({ ...base, trim: 'Limited' })
    expect(result.trim).toBe('Limited')
  })

  it('transforms a blanked-out trim ("") to null', () => {
    const result = vehicleEditSchema.parse({ ...base, trim: '' })
    expect(result.trim).toBeNull()
  })

  it('leaves an omitted trim as undefined (not an explicit null)', () => {
    // CRITICAL regression: `.optional()` must compose outside the transform.
    // Non-motorized vehicles (Trailer/FifthWheel/TravelTrailer) never
    // register `trim` in VehicleEdit, so the key is absent from the
    // submitted object. Previously the schema synthesized an explicit
    // `null` for every omitted key on parse, which survived JSON.stringify
    // and force-cleared the column via `exclude_unset=True` on every save
    // of a non-motorized vehicle.
    const result = vehicleEditSchema.parse({ ...base })
    expect(result.trim).toBeUndefined()
  })

  it('transforms a null trim to null', () => {
    const result = vehicleEditSchema.parse({ ...base, trim: null })
    expect(result.trim).toBeNull()
  })

  // JSON.stringify's null-vs-undefined serialization behavior is already
  // locked in by the fuel_type round-trip test above; trim goes through
  // the same `nullOnBlank` transform, so re-asserting it here would only
  // re-test JSON.stringify itself, not new schema logic.

  it('transforms a blanked-out make ("") to null (spot-check a second sibling field)', () => {
    const result = vehicleEditSchema.parse({ ...base, make: '' })
    expect(result.make).toBeNull()
  })
})

// CRITICAL regression (whole-branch review): VehicleEditDrawer.tsx only registers
// trim/body_class/drive_type/gvwr_class/displacement_l/transmission_type/
// transmission_speeds for motorized vehicles — a non-motorized submit
// (Trailer/FifthWheel/TravelTrailer) never has these keys at all. Confirms
// the fix end-to-end: parsing that shape must not resurrect any of the seven
// keys as an explicit `null` on the output, because such a `null` would
// survive JSON.stringify and force-clear the columns via the backend's
// `exclude_unset=True` partial update — this is exactly how a live FifthWheel
// lost its `body_class='Trailer'` / `transmission_type='Not Applicable'`.
describe('vehicleEditSchema — non-motorized submit shape omits VIN/engine keys entirely', () => {
  it('produces JSON with none of the seven unregistered keys present', () => {
    const nonMotorizedSubmit = {
      ...base,
      vehicle_type: 'FifthWheel',
      // trim, body_class, drive_type, gvwr_class, displacement_l,
      // transmission_type, transmission_speeds intentionally absent — this
      // mirrors VehicleEdit's reset() for a non-motorized vehicle_type.
    }

    const result = vehicleEditSchema.parse(nonMotorizedSubmit)
    const serialized = JSON.stringify(result)

    for (const key of [
      'trim',
      'body_class',
      'drive_type',
      'gvwr_class',
      'displacement_l',
      'transmission_type',
      'transmission_speeds',
    ]) {
      expect(serialized).not.toContain(`"${key}"`)
    }
  })
})

// Task 19 extension: the same null-on-clear bug affects the date fields
// (purchase_date, sold_date via optionalDateSchema) — clearing a
// previously-set date in the edit form must submit explicit `null`, not
// `undefined`.
describe('vehicleEditSchema — date fields null-on-clear', () => {
  it('passes through a set purchase_date unchanged', () => {
    const result = vehicleEditSchema.parse({ ...base, purchase_date: '2020-03-15' })
    expect(result.purchase_date).toBe('2020-03-15')
  })

  it('transforms a blanked-out purchase_date ("") to null', () => {
    const result = vehicleEditSchema.parse({ ...base, purchase_date: '' })
    expect(result.purchase_date).toBeNull()
  })

  it('transforms a null purchase_date to null', () => {
    const result = vehicleEditSchema.parse({ ...base, purchase_date: null })
    expect(result.purchase_date).toBeNull()
  })

  it('transforms a blanked-out sold_date ("") to null', () => {
    const result = vehicleEditSchema.parse({ ...base, sold_date: '' })
    expect(result.sold_date).toBeNull()
  })
})

// M4 (final-review, final fix wave): this is the exact shape the branch's
// one Critical lived in. purchasePriceSchema/soldPriceSchema originally
// ended `.optional().transform()`, so an omitted key still hit the
// transform and synthesized an explicit `null` on the output — which
// survives JSON.stringify and force-clears the column via the backend's
// `exclude_unset=True` partial update. They were reordered to
// `.transform().optional()` (see purchasePriceSchema/soldPriceSchema
// above), matching yearSchema/doorsSchema/cylindersSchema. Neither
// VehicleEditDrawer (Vehicle Settings) nor VehicleWizard's create payload
// registers purchase_price/sold_price any more — PricingDrawer owns them
// exclusively — so every settings-panel save omits both keys, and this
// pins that the parsed result has neither key as an *own property* at all
// (not merely `undefined`, which `toEqual` would treat as equivalent to
// absent and so would not discriminate the two schema orderings).
describe('vehicleEditSchema — purchase_price/sold_price stay absent when omitted (Critical regression)', () => {
  it('produces a result with neither purchase_price nor sold_price as an own property', () => {
    const settingsPanelSubmit = {
      ...base,
      // purchase_price, sold_price intentionally absent — VehicleEditDrawer
      // (Vehicle Settings) never registers either field; PricingDrawer is
      // the only editor that submits them.
    }

    const result = vehicleEditSchema.parse(settingsPanelSubmit)

    expect(Object.prototype.hasOwnProperty.call(result, 'purchase_price')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(result, 'sold_price')).toBe(false)
  })
})

// Task 19 extension, UPDATED for Task 8/8b: year/doors/cylinders/
// purchase_price moved onto NumberInput/registerDecimal (Task 8), which
// never emits a raw NaN — empty becomes `undefined`, unparseable text
// becomes INVALID_NUMBER. Task 8b then widened the shared invalid-number
// guard (which numericOrNullField mirrors) to treat any NaN that DOES still
// arrive as invalid input rather than empty — so these four fields now
// REJECT NaN instead of silently collapsing it to null. `sold_price` has
// the same money field since money-fits (nothing registers it against this
// schema). A legitimate zero (e.g. a free vehicle, or 0 doors on a trailer)
// must still survive as 0, not become null: the backend accepts 0 on all of
// these.
describe('vehicleEditSchema — numeric fields null-on-clear (blank vs. zero)', () => {
  it('rejects a NaN purchase_price as invalid rather than silently nulling it', () => {
    const result = vehicleEditSchema.safeParse({ ...base, purchase_price: NaN })
    expect(result.success).toBe(false)
  })

  it('transforms a null purchase_price to null', () => {
    const result = vehicleEditSchema.parse({ ...base, purchase_price: null })
    expect(result.purchase_price).toBeNull()
  })

  it('preserves a zero purchase_price as 0 (not null)', () => {
    const result = vehicleEditSchema.parse({ ...base, purchase_price: 0 })
    expect(result.purchase_price).toBe(0)
  })

  it('passes through a set purchase_price unchanged', () => {
    const result = vehicleEditSchema.parse({ ...base, purchase_price: 15000 })
    expect(result.purchase_price).toBe(15000)
  })

  // No form registers sold_price against this schema (PricingDrawer posts it
  // without one), so it takes purchase_price's money field rather than a
  // shape of its own: a NaN is refused, and a zero survives.
  it('sold_price takes the same money field: NaN refused, zero kept, null kept', () => {
    expect(vehicleEditSchema.safeParse({ ...base, sold_price: NaN }).success).toBe(false)
    expect(vehicleEditSchema.parse({ ...base, sold_price: 0 }).sold_price).toBe(0)
    expect(vehicleEditSchema.parse({ ...base, sold_price: null }).sold_price).toBeNull()
  })

  it('rejects a NaN year as invalid rather than silently nulling it', () => {
    const result = vehicleEditSchema.safeParse({ ...base, year: NaN })
    expect(result.success).toBe(false)
  })

  it('rejects a NaN doors as invalid but still preserves a real zero', () => {
    expect(vehicleEditSchema.safeParse({ ...base, doors: NaN }).success).toBe(false)
    expect(vehicleEditSchema.parse({ ...base, doors: 0 }).doors).toBe(0)
  })

  it('rejects a NaN cylinders as invalid but still preserves a real zero', () => {
    expect(vehicleEditSchema.safeParse({ ...base, cylinders: NaN }).success).toBe(false)
    expect(vehicleEditSchema.parse({ ...base, cylinders: 0 }).cylinders).toBe(0)
  })
})

// Regression for the CRITICAL finding: the pre-refactor `.or(z.nan())` shape
// these six fields used couldn't recognize INVALID_NUMBER (the sentinel
// registerDecimal emits for unparseable text) and leaked zod's raw "Invalid
// input: expected number, received symbol" instead of a translated message.
// `sold_price` is excluded: no form wires it through registerDecimal, so it
// can't receive the sentinel.
// money-fits (B3/B6): the API takes 0 to MONEY_MAX on both prices. The wizard
// used to accept a negative purchase price, which B3's `ge=0` now refuses.
describe('vehicleEditSchema: purchase_price/sold_price money bounds', () => {
  it.each(['purchase_price', 'sold_price'])('%s takes 0 to MONEY_MAX and refuses either side', (field) => {
    expect(vehicleEditSchema.safeParse({ ...base, [field]: 0 }).success).toBe(true)
    expect(vehicleEditSchema.safeParse({ ...base, [field]: MONEY_MAX }).success).toBe(true)

    const negative = vehicleEditSchema.safeParse({ ...base, [field]: -5 })
    expect(negative.success).toBe(false)
    if (!negative.success) expect(negative.error.issues[0].message).toBe('common:validation.amount.negative')

    const over = vehicleEditSchema.safeParse({ ...base, [field]: MONEY_MAX + 0.01 })
    expect(over.success).toBe(false)
    if (!over.success) expect(over.error.issues[0].message).toBe('common:validation.amount.tooLarge')
  })
})

describe('vehicleEditSchema — INVALID_NUMBER sentinel (Task 8 critical fix)', () => {
  it('rejects the sentinel on every converted numeric field with a translated message, not a raw zod union error', () => {
    const result = vehicleEditSchema.safeParse({
      ...base,
      year: INVALID_NUMBER,
      doors: INVALID_NUMBER,
      cylinders: INVALID_NUMBER,
      purchase_price: INVALID_NUMBER,
      current_hours: INVALID_NUMBER,
      def_tank_capacity_liters: INVALID_NUMBER,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message)
      expect(messages).toContain('common:validation.vehicle.yearInvalid')
      expect(messages).toContain('common:validation.vehicle.doorsInvalid')
      expect(messages).toContain('common:validation.vehicle.cylindersInvalid')
      expect(messages).toContain('common:validation.vehicle.purchasePriceInvalid')
      expect(messages).toContain('common:validation.engineHours.invalid')
      expect(messages).toContain('common:validation.volume.invalid')
      for (const m of messages) {
        expect(m).not.toMatch(/received symbol|expected number/i)
      }
    }
  })

  it('still rejects a non-integer year/doors/cylinders with its own whole-number message', () => {
    expect(vehicleEditSchema.safeParse({ ...base, year: 1995.5 }).success).toBe(false)
    expect(vehicleEditSchema.safeParse({ ...base, doors: 4.5 }).success).toBe(false)
    expect(vehicleEditSchema.safeParse({ ...base, cylinders: 6.5 }).success).toBe(false)
  })

  it('still preserves def_tank_capacity_liters\' exact 0-9999.99 bound', () => {
    expect(vehicleEditSchema.safeParse({ ...base, def_tank_capacity_liters: -1 }).success).toBe(false)
    expect(vehicleEditSchema.safeParse({ ...base, def_tank_capacity_liters: 10000 }).success).toBe(false)
    expect(vehicleEditSchema.safeParse({ ...base, def_tank_capacity_liters: 9999.99 }).success).toBe(true)
  })

  it('still preserves current_hours\' non-negative bound', () => {
    expect(vehicleEditSchema.safeParse({ ...base, current_hours: -1 }).success).toBe(false)
    expect(vehicleEditSchema.parse({ ...base, current_hours: 812.4 }).current_hours).toBe(812.4)
  })
})

// Task 19 round 2 (Important fix): a vehicle stored with NULL
// year/doors/cylinders in the DB seeds the form with raw `null` — the
// schemas must accept null input (like the price schemas always did), or
// zod hard-fails and the user cannot save ANY edit without touching the
// numeric field.
describe('vehicleEditSchema — numeric fields accept null input (null-seeded vehicles)', () => {
  it('accepts a null year (NULL in DB) and passes null through', () => {
    const result = vehicleEditSchema.safeParse({ ...base, year: null })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.year).toBeNull()
  })

  it('accepts a null doors (NULL in DB) and passes null through', () => {
    const result = vehicleEditSchema.safeParse({ ...base, doors: null })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.doors).toBeNull()
  })

  it('accepts a null cylinders (NULL in DB) and passes null through', () => {
    const result = vehicleEditSchema.safeParse({ ...base, cylinders: null })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.cylinders).toBeNull()
  })

  it('still leaves an omitted doors key undefined (unregistered non-motorized fields must not force-clear)', () => {
    const result = vehicleEditSchema.parse({ ...base })
    expect(result.doors).toBeUndefined()
  })
})
