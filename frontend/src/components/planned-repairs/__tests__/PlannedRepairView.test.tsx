import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import type { PlannedRepair } from '../../../types/plannedRepair'

vi.mock('../../../hooks/queries/useSupplies', () => ({
  useSupplies: () => ({ data: { supplies: [{ id: 9, avg_unit_cost: '10' }] } }),
}))
vi.mock('../../../hooks/useUnitPreference', () => ({ useUnitPreference: () => ({ system: 'metric' }) }))
vi.mock('../../../hooks/useUnitFormat', () => ({
  useUnitFormat: () => ({ distance: { label: 'km', format: (v: number) => `${v} km` } }),
}))
vi.mock('../../../hooks/useDateLocale', () => ({ useDateLocale: () => 'en-US' }))
vi.mock('../../../hooks/useCurrencyPreference', () => ({
  useCurrencyPreference: () => ({ currencyCode: 'USD', locale: 'en-US', formatCurrency: (v: number) => `$${Number(v)}` }),
}))

import PlannedRepairView from '../PlannedRepairView'
import PlannedRepairCard from '../PlannedRepairCard'

const repair = (overrides: Partial<PlannedRepair> = {}) =>
  ({
    id: 1,
    vin: 'V1',
    title: 'Front brakes',
    description: 'Pads are down to 2 mm.\nRotors look fine.',
    status: 'planning',
    priority: 'high',
    service_category: 'Repair',
    estimated_cost: '250.00',
    target_date: '2026-11-01',
    target_odometer_km: '120000',
    vendor: { id: 3, name: 'Corner Garage' },
    service_visit_id: null,
    position: 0,
    created_at: '2026-10-01T00:00:00Z',
    parts: [
      { id: 11, description: 'Brake pads', cost: '80.00' },
      {
        id: 12,
        description: 'Brake fluid',
        supply_id: 9,
        supply_name: 'DOT 4 fluid',
        supply_quantity: '0.5',
        unit_type: 'volume',
        volume_unit: 'L',
      },
    ],
    photos: [{ id: 21 }, { id: 22 }, { id: 23 }, { id: 24 }],
    ...overrides,
  }) as unknown as PlannedRepair

describe('PlannedRepairView', () => {
  it('shows the whole repair in a centred dialog', () => {
    render(<PlannedRepairView repair={repair()} onClose={vi.fn()} onEdit={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Front brakes' })
    expect(dialog).toHaveAttribute('data-placement', 'center')
    expect(screen.getByText(/Rotors look fine\./)).toBeInTheDocument()
    expect(screen.getByText('$250')).toBeInTheDocument()
    expect(screen.getByText('120000 km')).toBeInTheDocument()
    expect(screen.getByText('Corner Garage')).toBeInTheDocument()
    expect(screen.getByText('Brake pads')).toBeInTheDocument()
    expect(screen.getByText(/DOT 4 fluid/)).toBeInTheDocument()
    expect(screen.getByText(/0\.50 L/)).toBeInTheDocument()
    // Every photo, not only the card's three.
    expect(screen.getAllByRole('img')).toHaveLength(4)
  })

  it('leaves out what was never filled in', () => {
    render(
      <PlannedRepairView
        repair={repair({
          description: null,
          estimated_cost: null,
          target_date: null,
          target_odometer_km: null,
          vendor: null,
          parts: [],
          photos: [],
        })}
        onClose={vi.fn()}
        onEdit={vi.fn()}
      />,
    )
    expect(screen.queryByText('plannedRepairs.fieldEstimate')).not.toBeInTheDocument()
    expect(screen.queryByText('plannedRepairs.fieldShop')).not.toBeInTheDocument()
    expect(screen.queryByText('plannedRepairs.photos')).not.toBeInTheDocument()
    expect(screen.getByText('plannedRepairs.noParts')).toBeInTheDocument()
  })

  it('hands the repair to onEdit from the Edit button', () => {
    const onEdit = vi.fn()
    render(<PlannedRepairView repair={repair()} onClose={vi.fn()} onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: 'common:edit' }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })
})

describe('PlannedRepairCard click', () => {
  const renderCard = () => {
    const handlers = { onView: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onMoveTo: vi.fn() }
    render(
      <DndContext>
        <PlannedRepairCard repair={repair()} {...handlers} />
      </DndContext>,
    )
    return handlers
  }

  it('opens the view when the card is clicked', () => {
    const { onView } = renderCard()
    fireEvent.click(screen.getByText('Front brakes'))
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })

  it('leaves the view closed when the menu or a thumbnail is clicked', () => {
    const { onView } = renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'plannedRepairs.actions' }))
    fireEvent.click(screen.getAllByRole('img')[0])
    expect(onView).not.toHaveBeenCalled()
  })
})
