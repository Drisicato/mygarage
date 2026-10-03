import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../../services/api'
import type { components } from '../../types/api.generated'
import type { Vehicle } from '../../types/vehicle'

// The generated schema, so a type the app doesn't know arrives typed as null
// rather than hiding behind a hand-written `string`.
export type QuickEntryVehicle = components['schemas']['QuickEntryVehicle']

type QuickEntryVehicleListResponse = components['schemas']['QuickEntryVehicleList']

/**
 * Writable, non-archived vehicles for the Quick Entry page.
 *
 * Uses the shared QueryClient defaults (retry + refetchOnWindowFocus), so a
 * transient failure right after a cold launch recovers on its own instead of
 * dead-ending — the failure mode behind #114.
 */
export function useQuickEntryVehicles() {
  return useQuery({
    queryKey: ['quickEntryVehicles'],
    queryFn: async (): Promise<QuickEntryVehicle[]> => {
      const { data } = await api.get<QuickEntryVehicleListResponse>('/quick-entry/vehicles')
      return data.vehicles
    },
  })
}

/**
 * Keep the Quick Entry list in step with a vehicle just saved (#172): the list
 * serves cached rows before any refetch lands, so a changed odometer unit
 * would otherwise open the next form in the old one. Patches only a list that
 * is already cached; creating one here would hand Quick Entry a one-row list
 * and auto-select that vehicle.
 *
 * @returns A callback taking the saved vehicle.
 */
export function useSyncQuickEntryVehicle(): (vehicle: Vehicle) => void {
  const queryClient = useQueryClient()
  return useCallback(
    (vehicle: Vehicle) => {
      queryClient.setQueryData<QuickEntryVehicle[]>(['quickEntryVehicles'], (old) =>
        old?.map((row) =>
          row.vin === vehicle.vin ? { ...row, distance_unit: vehicle.distance_unit ?? null } : row
        )
      )
      void queryClient.invalidateQueries({ queryKey: ['quickEntryVehicles'] })
    },
    [queryClient]
  )
}
