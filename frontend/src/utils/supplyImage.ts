import { withBase } from './basePath'

/** Google Images results for a part, from whatever identifies it. Null when there is nothing to search for. */
export function googleImageSearchUrl(name: string | null | undefined, partNumber: string | null | undefined): string | null {
  const query = [name, partNumber]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part)
    .join(' ')
  if (!query) return null
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`
}

/** URL of a supply's stored image. `version` (the supply's updated_at) busts the cache after a replace. */
export function supplyImageUrl(supplyId: number, version?: string | null): string {
  const suffix = version ? `?v=${encodeURIComponent(version)}` : ''
  return withBase(`/api/supplies/${supplyId}/image${suffix}`)
}

/** The first image on a clipboard or drop payload, if any. */
export function firstImageFile(files: FileList | null | undefined): File | null {
  if (!files) return null
  return Array.from(files).find((file) => file.type.startsWith('image/')) ?? null
}
