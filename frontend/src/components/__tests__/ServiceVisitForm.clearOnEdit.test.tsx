import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { render } from '../../__tests__/test-utils'
import ServiceVisitForm from '../ServiceVisitForm'
import type { ServiceVisit } from '../../types/serviceVisit'

// Clearing a field on edit has to reach the API as null. The update route
// drops keys that aren't sent (exclude_unset), so an undefined here kept the
// old vendor, notes, fees and readings no matter what the form showed.

const drawerForm = (): HTMLFormElement =>
  screen.getByRole('dialog').querySelector('form') as HTMLFormElement

const mockedApiGet = vi.fn()
const mockedApiPut = vi.fn().mockResolvedValue({ data: {} })

vi.mock('../../services/api', () => ({
  default: {
    get: (...args: unknown[]) => mockedApiGet(...args),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: (...args: unknown[]) => mockedApiPut(...args),
  },
}))

vi.mock('../../hooks/useUnitPreference', async () => {
  const { METRIC_UNITS } = await import('@/__tests__/factories')
  return {
    useUnitPreference: () => ({
      system: 'metric',
      showBoth: false,
      units: METRIC_UNITS,
      gallonStandard: 'us',
    }),
  }
})
vi.mock('../../hooks/useReminders', () => ({
  useMaintenanceTypes: () => ({ data: [] }),
  invalidateMaintenanceQueries: () => {},
}))
vi.mock('../../hooks/useCurrencyPreference', () => ({
  useCurrencyPreference: () => ({
    currencyCode: 'USD',
    locale: 'en-US',
    formatCurrency: () => '$0.00',
  }),
}))
vi.mock('../../hooks/queries/useSupplies', () => ({
  useSupplies: () => ({
    data: { supplies: [], total: 0 },
    isSuccess: true,
    isLoading: false,
    isError: false,
  }),
}))
// The real VendorSearch clears through onSelect(null); this stand-in does the same.
vi.mock('../VendorSearch', () => ({
  default: ({ value, onSelect }: { value?: number; onSelect: (v: null) => void }) => (
    <div data-testid="vendor-search" data-value={value ?? ''}>
      <button type="button" onClick={() => onSelect(null)}>clear vendor</button>
    </div>
  ),
}))
vi.mock('../ServiceVisitAttachmentUpload', () => ({
  default: () => <div data-testid="attachment-upload" />,
}))
vi.mock('../ServiceVisitAttachmentList', () => ({
  default: () => <div data-testid="attachment-list" />,
}))
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const VIN = 'TEST12345678901234'

const visit = {
  id: 900,
  vin: VIN,
  date: '2026-07-01',
  created_at: '2026-07-01T00:00:00',
  calculated_total_cost: '0.00',
  has_failed_inspections: false,
  line_item_count: 1,
  subtotal: '0.00',
  vendor_id: 7,
  odometer_km: '72420.0',
  engine_hours: '640.5',
  notes: 'Old notes',
  insurance_claim_number: 'CLM-1',
  tax_amount: '4.50',
  shop_supplies: '3.25',
  misc_fees: '2.00',
  service_category: null,
  total_cost: '0.00',
  updated_at: null,
  vendor: null,
  line_items: [
    {
      id: 501,
      visit_id: 900,
      description: 'Oil change',
      category: 'Maintenance',
      cost: null,
      created_at: '2026-07-01T00:00:00',
      is_failed_inspection: false,
      is_inspection: false,
      needs_followup: false,
      notes: null,
      triggered_by_inspection_id: null,
      supply_usages: [],
    },
  ],
} as unknown as ServiceVisit

const input = (id: string) => document.getElementById(id) as HTMLInputElement

async function renderEdit() {
  // Dual tracking, so both the odometer and the engine-hours inputs mount.
  mockedApiGet.mockResolvedValue({ data: { usage_unit: 'distance', secondary_usage_enabled: true } })
  render(<ServiceVisitForm vin={VIN} visit={visit} onClose={vi.fn()} onSuccess={vi.fn()} />)
  await waitFor(() => expect(input('service-engine-hours')).toBeInTheDocument())
}

async function submittedBody(): Promise<Record<string, unknown>> {
  fireEvent.submit(drawerForm())
  await waitFor(() => expect(mockedApiPut).toHaveBeenCalled())
  return mockedApiPut.mock.calls.at(-1)?.[1] as Record<string, unknown>
}

describe('ServiceVisitForm: clearing a field on edit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApiPut.mockResolvedValue({ data: {} })
  })

  it('sends null for every optional field the user cleared', async () => {
    await renderEdit()

    fireEvent.click(screen.getByRole('button', { name: 'clear vendor' }))
    for (const id of ['service-odometer', 'service-engine-hours', 'insurance-claim', 'visit-notes', 'tax-amount', 'shop-supplies', 'misc-fees']) {
      fireEvent.change(input(id), { target: { value: '' } })
    }

    const body = await submittedBody()
    expect(body).toMatchObject({
      vendor_id: null,
      odometer_km: null,
      engine_hours: null,
      insurance_claim_number: null,
      notes: null,
      tax_amount: null,
      shop_supplies: null,
      misc_fees: null,
    })
  })

  it('still sends the stored values when nothing was touched', async () => {
    await renderEdit()

    const body = await submittedBody()
    expect(body).toMatchObject({
      vendor_id: 7,
      odometer_km: 72420,
      engine_hours: 640.5,
      insurance_claim_number: 'CLM-1',
      notes: 'Old notes',
      tax_amount: 4.5,
      shop_supplies: 3.25,
      misc_fees: 2,
    })
  })
})
