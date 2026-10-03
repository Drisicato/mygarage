/**
 * #192: a pending reminder's bar, chip and order move with the vehicle's
 * readings, and the hero counts the same reminders. So every write that adds or
 * changes a reading, a reminder, a service visit or a tire refreshes both the
 * reminders list and the hero's detail-stats.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import {
  useCreateOdometerRecord,
  useUpdateOdometerRecord,
  useDeleteOdometerRecord,
  useImportOdometerCSV,
} from '../useOdometerRecords'
import { useCreateHoursRecord, useUpdateHoursRecord, useDeleteHoursRecord } from '../useHoursRecords'
import {
  useCreateFuelRecord,
  useUpdateFuelRecord,
  useDeleteFuelRecord,
  useImportFuelCSV,
} from '../useFuelRecords'
import { useCreateDEFRecord, useUpdateDEFRecord, useDeleteDEFRecord } from '../useDEFRecords'
import { useCreateServiceVisit } from '../useServiceVisits'
import { useCreateTire } from '../useTires'
import { invalidateMaintenanceQueries } from '../../useReminders'
import api from '../../../services/api'

vi.mock('../../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

const VIN = '1HGCM82633A004352'
const LIST = { queryKey: ['reminders', VIN] }
const HERO = { queryKey: ['vehicleDetailStats', VIN] }

beforeEach(() => {
  vi.clearAllMocks()
  for (const verb of ['post', 'put', 'delete'] as const) {
    vi.mocked(api[verb]).mockResolvedValue({ data: {} } as { data: unknown })
  }
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMutationHook = (vin: string) => { mutateAsync: (arg: any) => Promise<unknown> }

const CASES: [string, AnyMutationHook, unknown][] = [
  ['odometer create', useCreateOdometerRecord, { date: '2026-10-01', odometer_km: 1000 }],
  ['odometer update', useUpdateOdometerRecord, { id: 1, odometer_km: 1000 }],
  ['odometer delete', useDeleteOdometerRecord, 1],
  ['odometer import', useImportOdometerCSV, new FormData()],
  ['hours create', useCreateHoursRecord, { date: '2026-10-01', engine_hours: 10 }],
  ['hours update', useUpdateHoursRecord, { id: 1, engine_hours: 10 }],
  ['hours delete', useDeleteHoursRecord, 1],
  ['fuel create', useCreateFuelRecord, { date: '2026-10-01' }],
  ['fuel update', useUpdateFuelRecord, { id: 1 }],
  ['fuel delete', useDeleteFuelRecord, 1],
  ['fuel import', useImportFuelCSV, { formData: new FormData() }],
  ['DEF create', useCreateDEFRecord, { date: '2026-10-01', odometer_km: 1000 }],
  ['DEF update', useUpdateDEFRecord, { id: 1, odometer_km: 1000 }],
  ['DEF delete', useDeleteDEFRecord, 1],
  ['service visit create', useCreateServiceVisit, { date: '2026-10-01' }],
  ['tire create', useCreateTire, { brand: 'Test' }],
]

describe.each(CASES)('%s', (_name, useHook, arg) => {
  it('refreshes the reminders list and the hero', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const Wrap = ({ children }: { children: React.ReactNode }): React.ReactElement =>
      React.createElement(QueryClientProvider, { client: qc }, children)
    const { result } = renderHook(() => useHook(VIN), { wrapper: Wrap })
    await result.current.mutateAsync(arg)
    expect(spy).toHaveBeenCalledWith(LIST)
    expect(spy).toHaveBeenCalledWith(HERO)
  })
})

describe('invalidateMaintenanceQueries, which every reminder mutation calls', () => {
  it('refreshes the hero along with the list', () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    invalidateMaintenanceQueries(qc, VIN)
    expect(spy).toHaveBeenCalledWith(LIST)
    expect(spy).toHaveBeenCalledWith(HERO)
  })
})
