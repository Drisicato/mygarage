import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { PlannedRepair } from '../../../types/plannedRepair'

const completeMutate = vi.fn()

vi.mock('../../../hooks/queries/usePlannedRepairs', () => ({
  useCompletePlannedRepair: () => ({ mutateAsync: completeMutate, isPending: false }),
}))
vi.mock('../../../hooks/queries/useSupplies', () => ({ useSupplies: () => ({ data: { supplies: [] } }) }))
vi.mock('../../../hooks/useUnitPreference', () => ({ useUnitPreference: () => ({ system: 'metric' }) }))
vi.mock('../../../hooks/useUnitFormat', () => ({
  useUnitFormat: () => ({ distance: { label: 'km', format: (v: number) => String(v) } }),
}))
vi.mock('../../../hooks/useCurrencyPreference', () => ({
  useCurrencyPreference: () => ({ currencyCode: 'USD', formatCurrency: (v: number) => `$${Number(v).toFixed(2)}` }),
}))
vi.mock('../../../utils/unitFormat', () => ({
  seedUnitField: () => ({ display: '' }),
  canonicalFromUnitField: () => null,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('../../VendorSearch', () => ({ default: () => <div /> }))
vi.mock('../../FormModalWrapper', () => ({
  default: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}))

import CompleteRepairDialog from '../CompleteRepairDialog'

const base = {
  id: 7,
  vin: 'V1',
  title: 'Multiair replacement',
  status: 'in_progress',
  priority: 'medium',
  position: 0,
  created_at: '2026-11-01T00:00:00',
  photos: [],
} as const

const renderDialog = (repair: PlannedRepair) => {
  const onSuccess = vi.fn()
  render(
    <CompleteRepairDialog
      vin="V1"
      repair={repair}
      tracksDistance={false}
      tracksHours={false}
      onClose={vi.fn()}
      onSuccess={onSuccess}
    />,
  )
  return { onSuccess }
}

const submit = () => fireEvent.submit(document.getElementById('complete-repair-form') as HTMLFormElement)

describe('CompleteRepairDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    completeMutate.mockResolvedValue({})
  })

  it('logs jobs as labor and sends typed-in parts to become supplies', async () => {
    const repair = {
      ...base,
      parts: [
        { id: 1, kind: 'part', description: 'Multiair unit', part_number: '04893749AE', cost: '1000.00', has_image: true },
        { id: 2, kind: 'part', description: 'Gasket', cost: '15.00', quantity: '2.000', has_image: false },
        { id: 3, kind: 'job', description: 'Install', cost: '300.00', has_image: false },
      ],
    } as unknown as PlannedRepair
    const { onSuccess } = renderDialog(repair)

    // The price paid differs from the estimate.
    fireEvent.change(screen.getAllByRole('textbox', { name: 'plannedRepairs.complete.partPrice' })[0], {
      target: { value: '950' },
    })
    submit()

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    const { visit } = completeMutate.mock.calls[0][0]
    expect(visit.line_items).toHaveLength(1)
    expect(visit.line_items[0]).toMatchObject({ description: 'Install', cost: 300, supplies_used: [] })
    expect(visit.parts).toEqual([
      { part_id: 1, quantity: 1, cost: 950 },
      { part_id: 2, quantity: 2, cost: 15 },
    ])
    expect(visit.parts_line_item).toBe(0)
  })

  it('puts the parts on a line item named after the repair when it has no jobs', async () => {
    const repair = {
      ...base,
      estimated_cost: '1200.00',
      parts: [{ id: 1, kind: 'part', description: 'Multiair unit', cost: '1000.00', has_image: false }],
    } as unknown as PlannedRepair
    const { onSuccess } = renderDialog(repair)
    submit()

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    const { visit } = completeMutate.mock.calls[0][0]
    // The parts carry the cost, so the estimate isn't booked as labor on top.
    expect(visit.line_items).toEqual([expect.objectContaining({ description: 'Multiair replacement', cost: null })])
    expect(visit.parts).toEqual([{ part_id: 1, quantity: 1, cost: 1000 }])
  })

  it('books the estimate when the repair has neither jobs nor parts', async () => {
    const repair = { ...base, estimated_cost: '250.00', parts: [] } as unknown as PlannedRepair
    const { onSuccess } = renderDialog(repair)
    submit()

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    const { visit } = completeMutate.mock.calls[0][0]
    expect(visit.line_items).toEqual([expect.objectContaining({ description: 'Multiair replacement', cost: 250 })])
    expect(visit.parts).toEqual([])
  })
})
