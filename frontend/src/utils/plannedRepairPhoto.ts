import { withBase } from './basePath'

/** Most photos a repair holds; the server enforces the same limit. */
export const MAX_REPAIR_PHOTOS = 12

/** URL of a planned repair's stored photo (always a JPEG, so a photo never changes under its id). */
export function repairPhotoUrl(vin: string, repairId: number, photoId: number): string {
  return withBase(`/api/vehicles/${vin}/planned-repairs/${repairId}/photos/${photoId}`)
}

/** URL of a planned repair part's picture. `version` (its image_version) busts the cache after a replace. */
export function repairPartImageUrl(vin: string, repairId: number, partId: number, version?: string | null): string {
  const suffix = version ? `?v=${encodeURIComponent(version)}` : ''
  return withBase(`/api/vehicles/${vin}/planned-repairs/${repairId}/parts/${partId}/image${suffix}`)
}
