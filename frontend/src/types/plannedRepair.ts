// ============================================================================
// Section A: Generated type aliases from OpenAPI schema
// Source of truth: backend Pydantic models -> openapi.json -> api.generated.ts
// Run `bun run generate:api` after backend schema changes and commit both files.
// ============================================================================

import type { components } from './api.generated'

export type PlannedRepair = components['schemas']['PlannedRepairResponse']
export type PlannedRepairCreate = components['schemas']['PlannedRepairCreate']
export type PlannedRepairUpdate = components['schemas']['PlannedRepairUpdate']
export type PlannedRepairPhoto = components['schemas']['PlannedRepairPhotoResponse']
export type PlannedRepairMove = components['schemas']['PlannedRepairMove']
export type PlannedRepairListResponse = components['schemas']['PlannedRepairListResponse']

// ============================================================================
// Section B: Frontend-only types
// ============================================================================

export type RepairStatus = PlannedRepair['status']
export type RepairPriority = PlannedRepair['priority']

/** Board column order, left to right. */
export const REPAIR_STATUSES: readonly RepairStatus[] = ['planning', 'in_progress', 'done']
export const REPAIR_PRIORITIES: readonly RepairPriority[] = ['low', 'medium', 'high', 'urgent']

export type VehicleSystem = NonNullable<PlannedRepair['systems']>[number]
export type PlannedRepairPart = NonNullable<PlannedRepair['parts']>[number]

/** The vehicle systems a repair can be tagged with, in the API's order. */
export const VEHICLE_SYSTEMS: readonly VehicleSystem[] = [
  'engine',
  'transmission',
  'differential',
  'drivetrain',
  'suspension',
  'steering',
  'brakes',
  'tires_wheels',
  'cooling',
  'exhaust',
  'fuel',
  'electrical',
  'hvac',
  'body',
  'interior',
  'other',
]
