import { z } from 'zod'

/**
 * Address-book categories, in display order.
 *
 * `value` is PERSISTED and sent to the backend verbatim — it must never be
 * translated or renamed. `labelKey` is resolved at the render site so the
 * <select> shows the user's language, matching the RELATIONSHIP_PRESETS
 * precedent in types/family.ts.
 */
export const ADDRESS_BOOK_CATEGORIES = [
  { value: 'Service', labelKey: 'common:addressBook.categoryService' },
  { value: 'RV Park', labelKey: 'common:addressBook.categoryRvPark' },
  { value: 'Dealer', labelKey: 'common:addressBook.categoryDealer' },
  { value: 'Parts', labelKey: 'common:addressBook.categoryParts' },
  { value: 'Insurance', labelKey: 'common:addressBook.categoryInsurance' },
  { value: 'Gas Station', labelKey: 'common:addressBook.categoryGasStation' },
] as const

export type AddressBookCategory = (typeof ADDRESS_BOOK_CATEGORIES)[number]['value']

/**
 * The Address Book chip a POI type belongs in, or '' for a type with no chip
 * (ev_charging, propane, none).
 *
 * The POI Finder saves a place with this as its category, and the Address
 * Book page files an entry with no category under it.
 */
export function chipForPoiCategory(poi: string | null | undefined): AddressBookCategory | '' {
  switch (poi) {
    case 'gas_station':
      return 'Gas Station'
    case 'rv_shop':
    case 'rv_park':
      return 'RV Park'
    case 'auto_shop':
      return 'Service'
    default:
      return ''
  }
}

export const addressBookSchema = z.object({
  business_name: z.string().min(1, 'Business name is required').max(150, 'Business name too long'),
  name: z.string().max(100, 'Contact name too long').optional(),
  email: z.string().email('Invalid email').or(z.literal('')).optional(),
  phone: z.string().max(20, 'Phone number too long').optional(),
  website: z.string().url('Invalid URL').or(z.literal('')).optional(),
  address: z.string().max(200, 'Address too long').optional(),
  city: z.string().max(100, 'City name too long').optional(),
  state: z.string().max(50, 'State/region too long').optional(),
  zip_code: z.string().max(10, 'ZIP code too long').optional(),
  category: z.string().optional(),
  notes: z.string().optional(),
})

export type AddressBookFormData = z.infer<typeof addressBookSchema>
