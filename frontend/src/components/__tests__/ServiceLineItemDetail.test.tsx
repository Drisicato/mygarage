import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '../../__tests__/test-utils'
import { METRIC_UNITS } from '../../__tests__/factories'
import type { ServiceVisit, ServiceLineItem } from '../../types/serviceVisit'

vi.mock('../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => ({ system: 'metric', showBoth: false, gallonStandard: 'us', units: METRIC_UNITS }),
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { currency_code: 'USD' } }),
}))

import ServiceLineItemDetail from '../ServiceLineItemDetail'

const visit = { id: 1, vin: 'V1', date: '2026-10-11', odometer_km: null } as unknown as ServiceVisit
const item = {
  id: 10,
  description: 'Front Brake Pads',
  cost: null,
  supply_usages: [
    { id: 5, supply_id: 42, supply_name: 'Front Brake Pads', quantity: '1', cost_snapshot: '49.48', unit_type: 'count' },
  ],
} as unknown as ServiceLineItem

describe('ServiceLineItemDetail supplies used', () => {
  it('links each supply to its page on Supplies', () => {
    render(<ServiceLineItemDetail visit={visit} item={item} onClose={vi.fn()} />)

    const link = screen.getByRole('link')
    expect(link).toHaveTextContent('Front Brake Pads')
    expect(link).toHaveAttribute('href', '/supplies?supply=42')
  })
})
