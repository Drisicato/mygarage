import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { VehicleInspection } from '../../../types/vehicleInspection'

const useVehicleInspectionsMock = vi.fn()
const deleteMutate = vi.fn()
const createRepairMutate = vi.fn()
const createCornerRepairMutate = vi.fn()

vi.mock('../../../hooks/queries/useVehicleInspections', () => ({
  useVehicleInspections: () => useVehicleInspectionsMock(),
  useDeleteVehicleInspection: () => ({ mutate: deleteMutate }),
  useCreateRepairFromInspectionItem: () => ({ mutate: createRepairMutate }),
  useCreateRepairFromInspectionCorner: () => ({ mutate: createCornerRepairMutate }),
}))
vi.mock('../../inspections/InspectionForm', () => ({
  default: ({ inspection }: { inspection?: VehicleInspection }) => (
    <div>{inspection ? `InspectionForm:${inspection.id}` : 'InspectionForm:new'}</div>
  ),
}))
vi.mock('../../../hooks/useDateLocale', () => ({ useDateLocale: () => undefined }))
vi.mock('../../../hooks/useUnitFormat', () => ({
  useUnitFormat: () => ({
    distance: { format: (v: number) => `${v} km` },
    tread: { format: (v: number) => `${v} mm` },
    pressure: { format: (v: number) => `${v} kPa` },
  }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import InspectionsTab from '../InspectionsTab'

const inspection = (overrides: Partial<VehicleInspection> = {}) =>
  ({
    id: 1,
    vin: 'V1',
    date: '2026-10-01',
    odometer_km: '85000',
    inspector: 'Self',
    tire_pressure_front_kpa: null,
    items: [
      { id: 10, item_key: 'exhaust', status: 'red', note: 'Rusted', planned_repair_id: null },
      { id: 11, item_key: 'coolant', status: 'yellow', note: null, planned_repair_id: 44 },
      { id: 12, item_key: 'wipers', status: 'green', note: null, planned_repair_id: null },
    ],
    corners: [],
    photos: [],
    counts: { green: 1, yellow: 1, red: 1, not_inspected: 0 },
    created_at: '2026-10-01T00:00:00',
    ...overrides,
  }) as unknown as VehicleInspection

describe('InspectionsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useVehicleInspectionsMock.mockReturnValue({
      data: { inspections: [inspection(), inspection({ id: 2, date: '2026-01-01' })], total: 2 },
      isLoading: false,
      error: null,
    })
  })

  it('shows the empty state with no inspections, and opens the form from it', () => {
    useVehicleInspectionsMock.mockReturnValue({ data: { inspections: [], total: 0 }, isLoading: false, error: null })
    render(<InspectionsTab vin="V1" />)
    expect(screen.getByText('vehicleInspections.empty')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'vehicleInspections.addFirst' }))
    expect(screen.getByText('InspectionForm:new')).toBeInTheDocument()
  })

  it('lists inspections in the order the API sends them, with their counts', () => {
    render(<InspectionsTab vin="V1" />)
    expect(screen.getAllByText('vehicleInspections.cardTitle')).toHaveLength(2)
    expect(screen.getAllByText('vehicleInspections.countRed')).toHaveLength(2)
    expect(screen.queryByText(/InspectionForm/)).not.toBeInTheDocument()
  })

  it('opens the form for a new inspection and for editing one', () => {
    render(<InspectionsTab vin="V1" />)
    fireEvent.click(screen.getByRole('button', { name: 'vehicleInspections.add' }))
    expect(screen.getByText('InspectionForm:new')).toBeInTheDocument()
  })

  it('opens the edit form from a card', () => {
    render(<InspectionsTab vin="V1" />)
    fireEvent.click(screen.getAllByRole('button', { name: 'vehicleInspections.editLabel' })[0])
    expect(screen.getByText('InspectionForm:1')).toBeInTheDocument()
  })

  it('creates a planned repair from an unlinked red item, and badges a linked one', () => {
    useVehicleInspectionsMock.mockReturnValue({
      data: { inspections: [inspection()], total: 1 },
      isLoading: false,
      error: null,
    })
    render(<InspectionsTab vin="V1" />)
    fireEvent.click(screen.getByRole('button', { name: 'vehicleInspections.showDetails' }))
    expect(screen.getByText('vehicleInspections.repairCreated')).toBeInTheDocument()
    const create = screen.getAllByRole('button', { name: 'vehicleInspections.createRepair' })
    expect(create).toHaveLength(1)
    fireEvent.click(create[0])
    expect(createRepairMutate).toHaveBeenCalledWith(
      { inspectionId: 1, itemKey: 'exhaust', title: 'vehicleInspections.items.exhaust' },
      expect.any(Object),
    )
  })

  it('offers a planned repair for a red tire or brake pad, and badges a linked one', () => {
    useVehicleInspectionsMock.mockReturnValue({
      data: {
        inspections: [
          inspection({
            items: [],
            corners: [
              {
                id: 1,
                position: 'lf',
                tread_status: 'red',
                tread_depth_mm: '2.4',
                brake_status: 'green',
                brake_pad_mm: '8',
                tread_repair_id: null,
                brake_repair_id: null,
              },
              {
                id: 2,
                position: 'rr',
                tread_status: 'yellow',
                tread_depth_mm: '4',
                brake_status: 'red',
                brake_pad_mm: '2',
                tread_repair_id: null,
                brake_repair_id: 51,
              },
            ],
          } as Partial<VehicleInspection>),
        ],
        total: 1,
      },
      isLoading: false,
      error: null,
    })
    render(<InspectionsTab vin="V1" />)
    fireEvent.click(screen.getByRole('button', { name: 'vehicleInspections.showDetails' }))
    expect(screen.getByText('vehicleInspections.tireAt')).toBeInTheDocument()
    expect(screen.getByText('vehicleInspections.brakeAt')).toBeInTheDocument()
    // The yellow tire gets no row; the linked brake shows its badge.
    expect(screen.getByText('vehicleInspections.repairCreated')).toBeInTheDocument()
    const create = screen.getAllByRole('button', { name: 'vehicleInspections.createRepair' })
    expect(create).toHaveLength(1)
    fireEvent.click(create[0])
    expect(createCornerRepairMutate).toHaveBeenCalledWith(
      { inspectionId: 1, position: 'lf', reading: 'tread', title: 'vehicleInspections.tireRepairTitle' },
      expect.any(Object),
    )
  })

  it('deletes only after confirmation', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<InspectionsTab vin="V1" />)
    const del = screen.getAllByRole('button', { name: 'vehicleInspections.deleteLabel' })[0]
    fireEvent.click(del)
    expect(deleteMutate).not.toHaveBeenCalled()
    fireEvent.click(del)
    expect(deleteMutate).toHaveBeenCalledWith(1, expect.any(Object))
    confirmSpy.mockRestore()
  })
})
