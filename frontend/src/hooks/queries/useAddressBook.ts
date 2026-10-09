import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/services/api'
import type { AddressBookEntry, AddressBookListResponse } from '@/types/addressBook'

/**
 * Address-book entries (the shared contact/vendor list) for supplier/vendor
 * pickers. GET /address-book returns the full unpaginated list.
 */
export function useAddressBookEntries() {
  return useQuery({
    queryKey: ['address-book', 'all'],
    queryFn: async () => {
      const { data } = await api.get<AddressBookListResponse>('/address-book')
      return data.entries
    },
    staleTime: 60_000,
  })
}

/** Adds a bare entry (just a business name), e.g. a supplier typed into a purchase form. */
export function useCreateAddressBookEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (businessName: string) => {
      const { data } = await api.post<AddressBookEntry>('/address-book', { business_name: businessName })
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['address-book'] }),
  })
}

/** The entry whose business name (or contact name) is `typed`, ignoring case and surrounding spaces. */
export function findAddressBookEntry(entries: AddressBookEntry[], typed: string): AddressBookEntry | undefined {
  const wanted = typed.trim().toLowerCase()
  if (!wanted) return undefined
  return entries.find(
    (entry) => entry.business_name?.trim().toLowerCase() === wanted || entry.name?.trim().toLowerCase() === wanted,
  )
}
