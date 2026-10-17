/**
 * The fixed multi-point checklist, laid out the way the inspection sheet reads.
 * The backend holds the same key list (`InspectionItemKey`); labels are i18n keys
 * under `vehicleInspections.items.*`, resolved at render time.
 */

import { withBase } from './basePath'
import { UNIT_ADAPTERS } from './unitAdapters'
import type {
  InspectionCornerPosition,
  InspectionItemKey,
  InspectionPointStatus,
} from '../types/vehicleInspection'

export type ChecklistSectionId = 'interior' | 'under_hood' | 'under_vehicle'

/** Inspection columns holding each section's comments. */
export type InspectionNotesField =
  | 'notes_interior'
  | 'notes_under_hood'
  | 'notes_under_vehicle'
  | 'notes_battery'
  | 'notes_tires'
  | 'notes_brakes'

export interface ChecklistSection {
  id: ChecklistSectionId
  notesField: InspectionNotesField
  items: readonly InspectionItemKey[]
}

export const CHECKLIST_SECTIONS: readonly ChecklistSection[] = [
  {
    id: 'interior',
    notesField: 'notes_interior',
    items: ['exterior_lights', 'wipers', 'rear_lights', 'cabin_filter'],
  },
  {
    id: 'under_hood',
    notesField: 'notes_under_hood',
    items: [
      'engine_oil',
      'coolant',
      'power_steering_fluid',
      'brake_fluid',
      'washer_fluid',
      'transmission_fluid',
      'cooling_system',
      'ac_system',
      'engine_air_filter',
      'drive_belts',
    ],
  },
  {
    id: 'under_vehicle',
    notesField: 'notes_under_vehicle',
    items: [
      'front_suspension',
      'rear_suspension',
      'differential',
      'drive_shaft',
      'exhaust',
      'axles',
      'fluid_leaks',
    ],
  },
]

/** Checklist points that live in the battery and tire sections rather than a list. */
export const BATTERY_ITEM: InspectionItemKey = 'battery'
export const TIRE_ROTATION_ITEM: InspectionItemKey = 'tire_rotation'

/** Every key, in sheet order. */
export const ALL_ITEM_KEYS: readonly InspectionItemKey[] = [
  ...CHECKLIST_SECTIONS.flatMap((s) => s.items),
  BATTERY_ITEM,
  TIRE_ROTATION_ITEM,
]

export const itemLabelKey = (key: string) => `vehicleInspections.items.${key}`
export const cornerLabelKey = (position: InspectionCornerPosition) => `vehicleInspections.corners.${position}`

/** A slider gauge: its range and step, and where its bands start, in the gauge's own unit. */
export interface Gauge {
  min: number
  max: number
  step: number
  /** At or above this is green. */
  greenFrom: number
  /** At or above this (and below green) is yellow; below it is red. */
  yellowFrom: number
}

/** Tread depth, in 32nds of an inch: 6/32 or more green, 4/32 to 5/32 yellow, 3/32 or less red. */
export const TREAD_GAUGE: Gauge = { min: 0, max: 12, step: 1, greenFrom: 6, yellowFrom: 4 }

/** Brake pad thickness, in mm: 6 mm or more green, 4 to 5 mm yellow, 3 mm or less red. */
export const BRAKE_GAUGE: Gauge = { min: 0, max: 12, step: 1, greenFrom: 6, yellowFrom: 4 }

/** The band a gauge reading falls in; null when nothing was measured. */
export function gaugeStatus(gauge: Gauge, value: number | null | undefined): InspectionPointStatus | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null
  if (value >= gauge.greenFrom) return 'green'
  if (value >= gauge.yellowFrom) return 'yellow'
  return 'red'
}

/** Stored tread (mm) to the gauge's whole 32nds. */
export function treadMmTo32nds(mm: number | null | undefined): number | null {
  if (mm == null || !Number.isFinite(mm)) return null
  return Math.round(UNIT_ADAPTERS.in32.toDisplay(mm) ?? 0)
}

/** The gauge's 32nds to stored mm. */
export function tread32ndsToMm(in32: number | null): number | null {
  return in32 == null ? null : UNIT_ADAPTERS.in32.toCanonical(in32)
}

/** The tread band a stored depth (mm) falls in, read to the nearest 32nd. */
export function treadStatusFromMm(mm: number | null | undefined): InspectionPointStatus | null {
  return gaugeStatus(TREAD_GAUGE, treadMmTo32nds(mm))
}

/** The brake band a pad thickness (mm) falls in, read to the nearest whole mm. */
export function brakeStatusFromMm(mm: number | null | undefined): InspectionPointStatus | null {
  return gaugeStatus(BRAKE_GAUGE, mm == null || !Number.isFinite(mm) ? null : Math.round(mm))
}

/** Most photos an inspection holds; the server enforces the same limit. */
export const MAX_INSPECTION_PHOTOS = 12

/** URL of an inspection's stored photo (always a JPEG). */
export function inspectionPhotoUrl(vin: string, inspectionId: number, photoId: number): string {
  return withBase(`/api/vehicles/${vin}/inspections/${inspectionId}/photos/${photoId}`)
}
