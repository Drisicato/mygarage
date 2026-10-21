import { describe, it, expect, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { render } from '../../__tests__/test-utils'
import SupplyUsedPicker from '../SupplyUsedPicker'
import type { Supply } from '../../types/supplies'

const VIN = '1HGCM82633A004352'
const OTHER_VIN = 'ZARFANBN1K7601799'

const supply = (id: number, name: string, extra: Partial<Supply> = {}): Supply => ({
  id,
  name,
  unit_type: 'count',
  avg_unit_cost: '5.00',
  on_hand: '3',
  is_active: true,
  is_negative: false,
  has_image: false,
  created_at: '2026-01-01T00:00:00',
  category: null,
  notes: null,
  part_number: null,
  updated_at: null,
  vins: [],
  ...extra,
})

const SUPPLIES = [
  supply(1, 'Oil Filter', { vins: [VIN], brand: 'Mopar', part_number: '68191349AA' }),
  supply(2, 'Wiper blades'),
  supply(3, 'Water Pump', { vins: [OTHER_VIN] }),
  supply(4, 'Air Filter', { brand: 'Wix' }),
]

describe('SupplyUsedPicker', () => {
  it("offers only shared and this vehicle's supplies in a row's dropdown, labelled with brand and part number", () => {
    render(
      <SupplyUsedPicker
        value={[{ supply_id: 1, quantity: 1 }]}
        onChange={vi.fn()}
        vin={VIN}
        supplies={SUPPLIES}
        unitsBySupplyId={new Map()}
      />,
    )

    const select = screen.getByRole('combobox')
    const labels = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(labels).toEqual(['Oil Filter · Mopar · 68191349AA', 'Wiper blades', 'Air Filter · Wix'])
  })

  it("keeps a row's current supply even when it belongs to another vehicle", () => {
    render(
      <SupplyUsedPicker
        value={[{ supply_id: 3, quantity: 1 }]}
        onChange={vi.fn()}
        vin={VIN}
        supplies={SUPPLIES}
        unitsBySupplyId={new Map()}
      />,
    )

    const labels = within(screen.getByRole('combobox')).getAllByRole('option').map((o) => o.textContent)
    expect(labels).toContain('Water Pump')
  })
})
