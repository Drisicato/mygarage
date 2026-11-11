import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { PlannedRepair } from '../../../types/plannedRepair'

const createMutate = vi.fn()
const updateMutate = vi.fn()

vi.mock('../../../hooks/queries/usePlannedRepairs', () => ({
  useCreatePlannedRepair: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdatePlannedRepair: () => ({ mutateAsync: updateMutate, isPending: false }),
  useUploadPlannedRepairPhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePlannedRepairPhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../../../hooks/queries/useSupplies', () => ({ useSupplies: () => ({ data: { supplies: [] } }) }))
vi.mock('../../../hooks/queries/useVehicle', () => ({
  useVehicle: () => ({ data: { vin: 'V1', year: 2014, make: 'Ford', model: 'F-150' } }),
}))
vi.mock('../../../hooks/useUnitPreference', () => ({ useUnitPreference: () => ({ system: 'metric' }) }))
vi.mock('../../../hooks/useUnitFormat', () => ({
  useUnitFormat: () => ({ distance: { label: 'km', format: (v: number) => String(v) } }),
}))
vi.mock('../../../hooks/useCurrencyPreference', () => ({
  useCurrencyPreference: () => ({ currencyCode: 'USD', formatCurrency: (v: number) => `$${v.toFixed(2)}` }),
}))
vi.mock('../../../utils/unitFormat', () => ({
  seedUnitField: () => ({ display: '' }),
  canonicalFromUnitField: () => null,
}))
vi.mock('../../VendorSearch', () => ({ default: () => <div /> }))
vi.mock('../../FormModalWrapper', () => ({
  default: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}))

import PlannedRepairForm from '../PlannedRepairForm'

// The vehicles namespace isn't loaded under test, so labels read as their keys.
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } })

const save = () => fireEvent.submit(document.getElementById('planned-repair-form') as HTMLFormElement)

describe('PlannedRepairForm parts and systems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createMutate.mockResolvedValue({ id: 7 })
    updateMutate.mockResolvedValue({ id: 7 })
  })

  const renderForm = (repair?: PlannedRepair) => {
    const onSuccess = vi.fn()
    render(<PlannedRepairForm vin="V1" repair={repair} onClose={vi.fn()} onSuccess={onSuccess} />)
    fireEvent.change(document.getElementById('repair-title') as HTMLInputElement, { target: { value: 'Water pump' } })
    return { onSuccess }
  }

  it('sends the part number, price each, quantity, link and systems', async () => {
    const { onSuccess } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'plannedRepairs.addPart' }))
    type('plannedRepairs.partName', 'Water pump')
    type('plannedRepairs.partNumberLabel', ' WP-1234 ')
    type('plannedRepairs.priceEachLabel', '45.50')
    type('plannedRepairs.qtyNeededLabel', '2')
    type('plannedRepairs.partLinkLabel', 'https://www.rockauto.com/x')
    fireEvent.click(screen.getByRole('button', { name: 'plannedRepairs.system.cooling' }))
    fireEvent.click(screen.getByRole('button', { name: 'plannedRepairs.system.engine' }))

    expect(screen.getByText('plannedRepairs.lineTotal')).toBeTruthy()
    save()

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    const payload = createMutate.mock.calls[0][0]
    // In the vocabulary's order, not the order they were picked.
    expect(payload.systems).toEqual(['engine', 'cooling'])
    expect(payload.parts).toEqual([
      {
        description: 'Water pump',
        part_number: 'WP-1234',
        cost: 45.5,
        quantity: 2,
        url: 'https://www.rockauto.com/x',
      },
    ])
  })

  it('links the part number searches with the vehicle', () => {
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'plannedRepairs.addPart' }))
    const searches = () => screen.queryAllByRole('link', { name: 'plannedRepairs.searchOn' })
    expect(searches()).toHaveLength(0)

    type('plannedRepairs.partNumberLabel', 'WP-1234')

    const links = searches()
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://www.google.com/search?q=WP-1234%202014%20Ford%20F-150',
      'https://www.rockauto.com/en/partsearch/?partnum=WP-1234',
      'https://www.amazon.com/s?k=WP-1234%202014%20Ford%20F-150',
      'https://www.ebay.com/sch/i.html?_nkw=WP-1234%202014%20Ford%20F-150',
    ])
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    }
  })

  it('refuses a link that is not a web address and a zero quantity', async () => {
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'plannedRepairs.addPart' }))
    type('plannedRepairs.partName', 'Water pump')
    type('plannedRepairs.partLinkLabel', 'javascript:alert(1)')
    type('plannedRepairs.qtyNeededLabel', '0')
    save()

    expect(await screen.findByText('plannedRepairs.invalidUrl')).toBeTruthy()
    expect(screen.getByText('plannedRepairs.qtyRequired')).toBeTruthy()
    expect(createMutate).not.toHaveBeenCalled()
  })

  it('keeps the stored part detail and systems when editing', async () => {
    const repair = {
      id: 7,
      vin: 'V1',
      title: 'Water pump',
      status: 'planning',
      priority: 'medium',
      position: 0,
      created_at: '2026-11-01T00:00:00',
      systems: ['cooling'],
      photos: [],
      parts: [
        {
          id: 3,
          description: 'Water pump',
          part_number: 'WP-1234',
          cost: '45.50',
          quantity: '2.000',
          url: 'https://www.rockauto.com/x',
        },
      ],
    } as PlannedRepair
    const { onSuccess } = renderForm(repair)
    save()

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    const payload = updateMutate.mock.calls[0][0]
    expect(payload.systems).toEqual(['cooling'])
    expect(payload.parts[0]).toMatchObject({ part_number: 'WP-1234', cost: 45.5, quantity: 2 })
  })
})
