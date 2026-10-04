import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/services/api'
import { invalidateMaintenanceQueries } from '@/hooks/useReminders'
import type {
  PlannedRepair,
  PlannedRepairCreate,
  PlannedRepairListResponse,
  PlannedRepairMove,
  PlannedRepairUpdate,
} from '@/types/plannedRepair'
import type { ServiceVisitCreate } from '@/types/serviceVisit'

const repairsKey = (vin: string) => ['plannedRepairs', vin]

export function usePlannedRepairs(vin: string) {
  return useQuery({
    queryKey: repairsKey(vin),
    queryFn: async () => {
      const { data } = await api.get<PlannedRepairListResponse>(
        `/vehicles/${vin}/planned-repairs`
      )
      return data
    },
    enabled: !!vin,
  })
}

export function useCreatePlannedRepair(vin: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: PlannedRepairCreate) => {
      const { data } = await api.post<PlannedRepair>(`/vehicles/${vin}/planned-repairs`, payload)
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: repairsKey(vin) })
    },
  })
}

export function useUpdatePlannedRepair(vin: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...payload }: PlannedRepairUpdate & { id: number }) => {
      const { data } = await api.put<PlannedRepair>(
        `/vehicles/${vin}/planned-repairs/${id}`,
        payload
      )
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: repairsKey(vin) })
    },
  })
}

export function useDeletePlannedRepair(vin: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (repairId: number) => {
      await api.delete(`/vehicles/${vin}/planned-repairs/${repairId}`)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: repairsKey(vin) })
    },
  })
}

/**
 * Reorder the cached board the way the server will, so a dropped card stays
 * where it was dropped instead of snapping back until the refetch lands.
 */
function applyMove(
  list: PlannedRepairListResponse,
  id: number,
  { status, position }: PlannedRepairMove
): PlannedRepairListResponse {
  const moving = list.repairs.find((r) => r.id === id)
  if (!moving) return list
  const others = list.repairs.filter((r) => r.id !== id)
  const target = others.filter((r) => r.status === status)
  const index = Math.min(position ?? target.length, target.length)
  target.splice(index, 0, { ...moving, status })
  const renumbered = new Map(target.map((r, i) => [r.id, { ...r, position: i }]))
  const repairs = [
    ...others.filter((r) => r.status !== status),
    ...renumbered.values(),
  ]
  return { ...list, repairs }
}

export function useMovePlannedRepair(vin: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...move }: PlannedRepairMove & { id: number }) => {
      const { data } = await api.post<PlannedRepair>(
        `/vehicles/${vin}/planned-repairs/${id}/move`,
        move
      )
      return data
    },
    onMutate: async ({ id, ...move }) => {
      await queryClient.cancelQueries({ queryKey: repairsKey(vin) })
      const previous = queryClient.getQueryData<PlannedRepairListResponse>(repairsKey(vin))
      if (previous) {
        queryClient.setQueryData(repairsKey(vin), applyMove(previous, id, move))
      }
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(repairsKey(vin), context.previous)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: repairsKey(vin) })
    },
  })
}

export function useCompletePlannedRepair(vin: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, visit }: { id: number; visit: ServiceVisitCreate }) => {
      const { data } = await api.post<PlannedRepair>(
        `/vehicles/${vin}/planned-repairs/${id}/complete`,
        visit
      )
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: repairsKey(vin) })
      // The visit it logs is a service like any other: history, readings
      // and reminders all move, and any supplies it used are drawn down.
      invalidateMaintenanceQueries(queryClient, vin)
      void queryClient.invalidateQueries({ queryKey: ['supplies'] })
    },
  })
}
