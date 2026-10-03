import { describe, it, expect } from 'vitest'
import type { Supply } from '@/types/supplies'
import { canonicalCategories, filterSupplies, isOutOfStock, type SupplyFilters } from '../supplyListView'

const base = {
  id: 1, name: 'Mobil 1 5W-30', part_number: 'M1-5W30', barcode: null,
  category: 'Fluids', unit_type: 'volume', vin: null, is_active: true,
  notes: null, on_hand: '3.000', avg_unit_cost: '9.00', is_negative: false,
  created_at: '2026-01-01T00:00:00Z', updated_at: null,
} as Supply
const supply = (over: Partial<Supply>): Supply => ({ ...base, ...over })
const none: SupplyFilters = { query: '', category: null, vehicle: 'all', outOfStock: false }

describe('isOutOfStock', () => {
  it('reads the decimal string, not the string identity', () => {
    expect(isOutOfStock(supply({ on_hand: '0.000' }))).toBe(true)
    expect(isOutOfStock(supply({ on_hand: '-1.500' }))).toBe(true)
    expect(isOutOfStock(supply({ on_hand: '0.001' }))).toBe(false)
  })
})

describe('canonicalCategories', () => {
  it('merges case-insensitively and keeps the most common spelling', () => {
    const list = [
      supply({ id: 1, category: 'fluids' }), supply({ id: 2, category: 'Fluids' }),
      supply({ id: 3, category: 'Fluids' }), supply({ id: 4, category: 'Filters' }),
      supply({ id: 5, category: null }),
    ]
    expect(canonicalCategories(list)).toEqual(['Filters', 'Fluids'])
  })
  it('breaks a spelling tie on first appearance', () => {
    const list = [supply({ id: 1, category: 'brake' }), supply({ id: 2, category: 'Brake' })]
    expect(canonicalCategories(list)).toEqual(['brake'])
  })
})

describe('filterSupplies', () => {
  it('matches name, part number, barcode, category and notes, trimmed and case-insensitive', () => {
    const s = supply({ barcode: '012345', notes: 'for the truck' })
    for (const q of ['mobil', 'm1-5w30', '012345', 'FLUIDS', '  truck  ']) {
      expect(filterSupplies([s], { ...none, query: q })).toEqual([s])
    }
    expect(filterSupplies([s], { ...none, query: 'coolant' })).toEqual([])
  })
  it('category filter is case-insensitive', () => {
    const s = supply({ category: 'fluids' })
    expect(filterSupplies([s], { ...none, category: 'Fluids' })).toEqual([s])
  })
  it('vehicle filter: shared matches null vin, a vin matches itself', () => {
    const shared = supply({ id: 1, vin: null })
    const pinned = supply({ id: 2, vin: '1HGCM82633A004352' })
    expect(filterSupplies([shared, pinned], { ...none, vehicle: 'shared' })).toEqual([shared])
    expect(filterSupplies([shared, pinned], { ...none, vehicle: '1HGCM82633A004352' })).toEqual([pinned])
  })
  it('out of stock keeps zero and negative only', () => {
    const list = [supply({ id: 1, on_hand: '0.000' }), supply({ id: 2, on_hand: '5.000' })]
    expect(filterSupplies(list, { ...none, outOfStock: true }).map((s) => s.id)).toEqual([1])
  })
})
