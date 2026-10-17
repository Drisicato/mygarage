import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/services/api'
import type {
  InspectionCornerPosition,
  InspectionCornerReading,
  InspectionItemKey,
  VehicleInspection,
  VehicleInspectionCreate,
  VehicleInspectionListResponse,
  VehicleInspectionPhoto,
  VehicleInspectionUpdate,
} from '@/types/vehicleInspection'

const inspectionsKey = (vin: string) => ['vehicleInspections', vin]

export function useVehicleInspections(vin: string) {
  return useQuery({
    queryKey: inspectionsKey(vin),
    queryFn: async () => {
      const { data } = await api.get<VehicleInspectionListResponse>(`/vehicles/${vin}/inspections`)
      return data
    },
    enabled: !!vin,
  })
}

export function useCreateVehicleInspection(vin: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: VehicleInspectionCreate) => {
      const { data } = await api.post<VehicleInspection>(`/vehicles/${vin}/inspections`, payload)
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inspectionsKey(vin) })
    },
  })
}

export function useUpdateVehicleInspection(vin: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...payload }: VehicleInspectionUpdate & { id: number }) => {
      const { data } = await api.put<VehicleInspection>(`/vehicles/${vin}/inspections/${id}`, payload)
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inspectionsKey(vin) })
    },
  })
}

export function useDeleteVehicleInspection(vin: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (inspectionId: number) => {
      await api.delete(`/vehicles/${vin}/inspections/${inspectionId}`)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inspectionsKey(vin) })
    },
  })
}

export function useUploadVehicleInspectionPhoto(vin: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ inspectionId, file }: { inspectionId: number; file: File }) => {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await api.post<VehicleInspectionPhoto>(
        `/vehicles/${vin}/inspections/${inspectionId}/photos`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inspectionsKey(vin) })
    },
  })
}

export function useDeleteVehicleInspectionPhoto(vin: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ inspectionId, photoId }: { inspectionId: number; photoId: number }) => {
      await api.delete(`/vehicles/${vin}/inspections/${inspectionId}/photos/${photoId}`)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inspectionsKey(vin) })
    },
  })
}

/** Turn a red or yellow checklist point into a planned repair, linked back to the point. */
export function useCreateRepairFromInspectionItem(vin: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      inspectionId,
      itemKey,
      title,
    }: {
      inspectionId: number
      itemKey: InspectionItemKey
      title: string
    }) => {
      const { data } = await api.post<VehicleInspection>(
        `/vehicles/${vin}/inspections/${inspectionId}/items/${itemKey}/planned-repair`,
        { title }
      )
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inspectionsKey(vin) })
      void queryClient.invalidateQueries({ queryKey: ['plannedRepairs', vin] })
    },
  })
}

/** Turn a red tire (tread) or brake pad on one wheel into a planned repair, linked back to it. */
export function useCreateRepairFromInspectionCorner(vin: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      inspectionId,
      position,
      reading,
      title,
    }: {
      inspectionId: number
      position: InspectionCornerPosition
      reading: InspectionCornerReading
      title: string
    }) => {
      const { data } = await api.post<VehicleInspection>(
        `/vehicles/${vin}/inspections/${inspectionId}/corners/${position}/${reading}/planned-repair`,
        { title }
      )
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inspectionsKey(vin) })
      void queryClient.invalidateQueries({ queryKey: ['plannedRepairs', vin] })
    },
  })
}
