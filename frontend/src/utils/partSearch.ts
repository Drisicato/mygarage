/**
 * Web searches for a part number, used by the planned repair part rows.
 * Each opens in a new tab; the user saves the listing they pick as the
 * part's link.
 */

export const PART_SEARCH_SITES = ['google', 'rockauto', 'amazon', 'ebay'] as const
export type PartSearchSite = (typeof PART_SEARCH_SITES)[number]

export interface PartSearchVehicle {
  year?: number | null
  make?: string | null
  model?: string | null
}

const SEARCH_URL: Record<PartSearchSite, (query: string) => string> = {
  google: (q) => `https://www.google.com/search?q=${q}`,
  rockauto: (q) => `https://www.rockauto.com/en/partsearch/?partnum=${q}`,
  amazon: (q) => `https://www.amazon.com/s?k=${q}`,
  ebay: (q) => `https://www.ebay.com/sch/i.html?_nkw=${q}`,
}

/**
 * The search text: the part number, then the vehicle's year, make and model.
 * RockAuto's part-number search takes the number alone; extra words make it
 * find nothing.
 */
export function partSearchQuery(partNumber: string, vehicle?: PartSearchVehicle | null): string {
  const words = [partNumber.trim(), vehicle?.year, vehicle?.make?.trim(), vehicle?.model?.trim()]
  return words.filter((w) => w !== undefined && w !== null && w !== '').join(' ')
}

/** One search link per site, or none while the part number is blank. */
export function partSearchLinks(
  partNumber: string,
  vehicle?: PartSearchVehicle | null,
): { site: PartSearchSite; url: string }[] {
  const number = partNumber.trim()
  if (!number) return []
  const full = encodeURIComponent(partSearchQuery(number, vehicle))
  return PART_SEARCH_SITES.map((site) => ({
    site,
    url: SEARCH_URL[site](site === 'rockauto' ? encodeURIComponent(number) : full),
  }))
}

/** Whether `text` is a web address a part link can open (http or https). */
export function isWebUrl(text: string): boolean {
  const trimmed = text.trim()
  if (!/^https?:\/\//i.test(trimmed)) return false
  try {
    new URL(trimmed)
    return true
  } catch {
    return false
  }
}
