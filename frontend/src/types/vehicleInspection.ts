// ============================================================================
// Section A: Generated type aliases from OpenAPI schema
// Source of truth: backend Pydantic models -> openapi.json -> api.generated.ts
// Run `bun run generate:api` after backend schema changes and commit both files.
// ============================================================================

import type { components } from './api.generated'

export type VehicleInspection = components['schemas']['VehicleInspectionResponse']
export type VehicleInspectionCreate = components['schemas']['VehicleInspectionCreate']
export type VehicleInspectionUpdate = components['schemas']['VehicleInspectionUpdate']
export type VehicleInspectionListResponse = components['schemas']['VehicleInspectionListResponse']
export type VehicleInspectionPhoto = components['schemas']['VehicleInspectionPhotoResponse']
export type VehicleInspectionItem = components['schemas']['InspectionItemResponse']
export type VehicleInspectionCorner = components['schemas']['InspectionCornerResponse']
export type VehicleInspectionItemInput = components['schemas']['InspectionItemInput']
export type VehicleInspectionCornerInput = components['schemas']['InspectionCornerInput']
export type VehicleInspectionCounts = components['schemas']['InspectionStatusCounts']

// ============================================================================
// Section B: Frontend-only types
// ============================================================================

/** green = OK, yellow = future attention, red = immediate attention. */
export type InspectionPointStatus = VehicleInspectionItem['status']
export type InspectionItemKey = VehicleInspectionItemInput['item_key']
export type InspectionCornerPosition = VehicleInspectionCornerInput['position']
/** Which wear reading on a wheel a planned repair is made from. */
export type InspectionCornerReading = 'tread' | 'brake'

export const INSPECTION_STATUSES: readonly InspectionPointStatus[] = ['green', 'yellow', 'red', 'not_inspected']
/** Wheel order on the sheet: front pair, then rear pair. */
export const INSPECTION_CORNERS: readonly InspectionCornerPosition[] = ['lf', 'rf', 'lr', 'rr']
