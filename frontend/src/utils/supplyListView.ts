import type { Supply } from '@/types/supplies'

export const SUPPLY_SORT_KEYS = ['name', 'stock', 'category'] as const
export type SupplySortKey = (typeof SUPPLY_SORT_KEYS)[number]
export const SUPPLY_GROUP_KEYS = ['none', 'category', 'vehicle'] as const
export type SupplyGroupKey = (typeof SUPPLY_GROUP_KEYS)[number]
export const SUPPLY_VIEW_KEYS = ['grid', 'list'] as const
export type SupplyViewKey = (typeof SUPPLY_VIEW_KEYS)[number]

export interface SupplyFilters {
  query: string
  category: string | null // canonical spelling from canonicalCategories; null = all
  vehicle: 'all' | 'shared' | string // a VIN otherwise
  outOfStock: boolean
}

// on_hand is a decimal string off the wire, so compare the number, not the text.
export function isOutOfStock(supply: Supply): boolean {
  return Number(supply.on_hand) <= 0
}

/**
 * Distinct categories, merged case-insensitively, each under its most common
 * spelling (tie goes to the spelling seen first), sorted for display.
 */
export function canonicalCategories(supplies: Supply[]): string[] {
  const buckets = new Map<string, Map<string, number>>()
  for (const s of supplies) {
    if (!s.category) continue
    const key = s.category.toLowerCase()
    const spellings = buckets.get(key) ?? new Map<string, number>()
    spellings.set(s.category, (spellings.get(s.category) ?? 0) + 1)
    buckets.set(key, spellings)
  }
  const canonical: string[] = []
  for (const spellings of buckets.values()) {
    let best = ''
    let bestCount = 0
    for (const [spelling, count] of spellings) {
      if (count > bestCount) {
        best = spelling
        bestCount = count
      }
    }
    canonical.push(best)
  }
  return canonical.sort((a, b) => a.localeCompare(b))
}

export function filterSupplies(supplies: Supply[], filters: SupplyFilters): Supply[] {
  const query = filters.query.trim().toLowerCase()
  const category = filters.category?.toLowerCase() ?? null
  return supplies.filter((s) => {
    if (query) {
      const haystack = [s.name, s.part_number, s.barcode, s.category, s.notes]
        .map((field) => (field ?? '').toLowerCase())
      if (!haystack.some((field) => field.includes(query))) return false
    }
    if (category !== null && (s.category ?? '').toLowerCase() !== category) return false
    if (filters.vehicle === 'shared') {
      if (s.vin != null) return false
    } else if (filters.vehicle !== 'all' && s.vin !== filters.vehicle) {
      return false
    }
    if (filters.outOfStock && !isOutOfStock(s)) return false
    return true
  })
}
