/**
 * Money for a planned repair's manual parts: `cost` is the price of one and
 * `quantity` how many (null means one).
 *
 * Numbers only: the API's decimal strings go through `Number()` and typed
 * text through `parseOptionalDecimal` (locale-aware) before they get here.
 */

/** How many of a manual part: one when none is given. */
export function partQuantity(quantity: number | null | undefined): number {
  return quantity == null || Number.isNaN(quantity) ? 1 : quantity
}

/** A manual part's line total, rounded to cents: price each times quantity. */
export function partLineTotal(cost: number | null | undefined, quantity: number | null | undefined): number {
  if (cost == null || Number.isNaN(cost)) return 0
  return Math.round(cost * partQuantity(quantity) * 100) / 100
}

/** The API's optional decimal string as a number, or null. */
export const apiNumber = (value: string | number | null | undefined): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value)
