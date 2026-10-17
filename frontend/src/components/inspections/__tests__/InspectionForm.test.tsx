import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { VehicleInspection, VehicleInspectionCreate } from '../../../types/vehicleInspection'
import {
  ALL_ITEM_KEYS,
  BRAKE_GAUGE,
  TREAD_GAUGE,
  brakeStatusFromMm,
  gaugeStatus,
  treadStatusFromMm,
} from '../../../utils/inspectionChecklist'

const createMutate = vi.fn()
const updateMutate = vi.fn()
const uploadMutate = vi.fn()
const deleteMutate = vi.fn()

vi.mock('../../../hooks/queries/useVehicleInspections', () => ({
  useCreateVehicleInspection: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateVehicleInspection: () => ({ mutateAsync: updateMutate, isPending: false }),
  useUploadVehicleInspectionPhoto: () => ({ mutateAsync: uploadMutate, isPending: false }),
  useDeleteVehicleInspectionPhoto: () => ({ mutateAsync: deleteMutate, isPending: false }),
}))
// The real adapters on the metric set, so pressures convert as they do in the app.
vi.mock('../../../hooks/useUnitFormat', async () => {
  const { makeUnitFormat } = await import('../../../utils/unitFormat')
  const { METRIC_UNITS } = await import('../../../__tests__/factories')
  const format = makeUnitFormat(METRIC_UNITS)
  return { useUnitFormat: () => format }
})
vi.mock('../../FormModalWrapper', () => ({
  default: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}))

import InspectionForm from '../InspectionForm'

const renderForm = (inspection?: VehicleInspection) => {
  const onSuccess = vi.fn()
  render(<InspectionForm vin="V1" inspection={inspection} onClose={vi.fn()} onSuccess={onSuccess} />)
  return { onSuccess }
}

const group = (label: string, scope: HTMLElement = document.body) =>
  within(scope).getByRole('group', { name: label })

const pressed = (groupEl: HTMLElement) =>
  within(groupEl)
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent || b.getAttribute('aria-label'))

const slide = (id: string, value: number) =>
  fireEvent.change(document.getElementById(id) as HTMLInputElement, { target: { value: String(value) } })

const submit = () => fireEvent.submit(document.getElementById('inspection-form') as HTMLFormElement)

describe('gauge bands', () => {
  it('bands tread on 32nds: 6+ green, 4-5 yellow, 3 or less red', () => {
    expect([12, 6, 5, 4, 3, 0].map((v) => gaugeStatus(TREAD_GAUGE, v))).toEqual([
      'green',
      'green',
      'yellow',
      'yellow',
      'red',
      'red',
    ])
    expect(gaugeStatus(TREAD_GAUGE, null)).toBeNull()
    // A stored depth reads to the nearest 32nd.
    expect(treadStatusFromMm((6 * 25.4) / 32)).toBe('green')
    expect(treadStatusFromMm(2.4)).toBe('red')
  })

  it('bands brake pads on mm: 6+ green, 4-5 yellow, 3 or less red', () => {
    expect([10, 6, 5, 4, 3, 0].map((v) => gaugeStatus(BRAKE_GAUGE, v))).toEqual([
      'green',
      'green',
      'yellow',
      'yellow',
      'red',
      'red',
    ])
    expect(brakeStatusFromMm(4.8)).toBe('yellow')
  })
})

describe('InspectionForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createMutate.mockResolvedValue({ id: 7 })
    updateMutate.mockResolvedValue({ id: 7 })
  })

  it('lists the revised checklist', () => {
    renderForm()
    expect(screen.queryByRole('group', { name: 'vehicleInspections.items.horn' })).not.toBeInTheDocument()
    for (const key of ['wipers', 'cooling_system', 'ac_system', 'battery']) {
      expect(group(`vehicleInspections.items.${key}`)).toBeInTheDocument()
    }
    const under = screen.getByRole('region', { name: 'vehicleInspections.sections.under_vehicle' })
    const labels = within(under)
      .getAllByRole('group')
      .map((g) => g.getAttribute('aria-label'))
    expect(labels.slice(0, 2)).toEqual([
      'vehicleInspections.items.front_suspension',
      'vehicleInspections.items.rear_suspension',
    ])
    expect(document.getElementById('inspection-battery-test')).toBeNull()
  })

  it('starts every point as not inspected and toggles a status', () => {
    renderForm()
    const wipers = group('vehicleInspections.items.wipers')
    expect(pressed(wipers)).toEqual(['vehicleInspections.status.not_inspected'])
    fireEvent.click(within(wipers).getByRole('button', { name: 'vehicleInspections.status.red' }))
    expect(pressed(wipers)).toEqual(['vehicleInspections.status.red'])
    expect(screen.getByLabelText('vehicleInspections.itemNote')).toBeInTheDocument()
  })

  it('marks the remaining points of a section OK', () => {
    renderForm()
    fireEvent.click(
      within(group('vehicleInspections.items.wipers')).getByRole('button', { name: 'vehicleInspections.status.yellow' }),
    )
    const section = screen.getByRole('region', { name: 'vehicleInspections.sections.interior' })
    fireEvent.click(within(section).getByRole('button', { name: 'vehicleInspections.markRemainingOk' }))
    expect(pressed(group('vehicleInspections.items.wipers'))).toEqual(['vehicleInspections.status.yellow'])
    expect(pressed(group('vehicleInspections.items.cabin_filter'))).toEqual(['vehicleInspections.status.green'])
    expect(pressed(group('vehicleInspections.items.engine_oil'))).toEqual(['vehicleInspections.status.not_inspected'])
  })

  it('shows the tread band the slider sits in, and clears back to not measured', () => {
    renderForm()
    const lf = screen.getByTestId('tire-lf')
    expect(within(lf).getByText('vehicleInspections.notMeasured')).toBeInTheDocument()
    slide('tread-lf', 3)
    expect(within(lf).getByText('vehicleInspections.status.red')).toBeInTheDocument()
    slide('tread-lf', 5)
    expect(within(lf).getByText('vehicleInspections.status.yellow')).toBeInTheDocument()
    slide('tread-lf', 6)
    expect(within(lf).getByText('vehicleInspections.status.green')).toBeInTheDocument()
    fireEvent.click(within(lf).getByRole('button', { name: 'vehicleInspections.clearReading' }))
    expect(within(lf).getByText('vehicleInspections.notMeasured')).toBeInTheDocument()
  })

  it('submits the checklist, front and rear pressure, and only the wheels with readings', async () => {
    const { onSuccess } = renderForm()
    fireEvent.click(
      within(group('vehicleInspections.items.exhaust')).getByRole('button', { name: 'vehicleInspections.status.red' }),
    )
    fireEvent.change(screen.getByLabelText('vehicleInspections.itemNote'), { target: { value: 'Rusted' } })
    fireEvent.change(document.getElementById('pressure-front') as HTMLInputElement, { target: { value: '240' } })
    fireEvent.change(document.getElementById('pressure-rear') as HTMLInputElement, { target: { value: '220' } })
    slide('tread-lf', 4)
    slide('brake-rr', 3)
    submit()

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    const payload = createMutate.mock.calls[0][0] as VehicleInspectionCreate
    expect(payload.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(payload.tire_pressure_front_kpa).toBe(240)
    expect(payload.tire_pressure_rear_kpa).toBe(220)
    expect(payload.items).toHaveLength(ALL_ITEM_KEYS.length)
    expect(payload.items?.find((i) => i.item_key === 'exhaust')).toEqual({
      item_key: 'exhaust',
      status: 'red',
      note: 'Rusted',
    })
    expect(payload.corners).toEqual([
      {
        position: 'lf',
        tread_status: 'yellow',
        tread_depth_mm: (4 * 25.4) / 32,
        brake_status: 'not_inspected',
        brake_pad_mm: null,
      },
      { position: 'rr', tread_status: 'not_inspected', tread_depth_mm: null, brake_status: 'red', brake_pad_mm: 3 },
    ])
    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('sends an untouched stored reading back as stored, not rounded to the gauge', async () => {
    const { onSuccess } = renderForm({
      id: 3,
      vin: 'V1',
      date: '2026-09-01',
      tire_pressure_front_kpa: '241.3',
      items: [{ id: 1, item_key: 'coolant', status: 'yellow', note: 'Low', planned_repair_id: null }],
      corners: [
        {
          id: 9,
          position: 'lf',
          tread_status: 'red',
          tread_depth_mm: '2.4',
          brake_status: 'yellow',
          brake_pad_mm: '4.8',
        },
      ],
      photos: [],
      created_at: '2026-09-01T00:00:00',
    } as unknown as VehicleInspection)
    expect(pressed(group('vehicleInspections.items.coolant'))).toEqual(['vehicleInspections.status.yellow'])
    expect(screen.getByTestId('tread-lf-value').textContent).toContain('3')
    submit()
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    const { id, ...payload } = updateMutate.mock.calls[0][0] as VehicleInspectionCreate & { id: number }
    expect(id).toBe(3)
    expect(payload.tire_pressure_front_kpa).toBe(241.3)
    expect(payload.corners).toEqual([
      { position: 'lf', tread_status: 'red', tread_depth_mm: 2.4, brake_status: 'yellow', brake_pad_mm: 4.8 },
    ])
  })
})
