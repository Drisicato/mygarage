// Service categories matching backend Literal type.
//
// The visit and line-item zod schemas that used to live here were never wired
// to ServiceVisitForm, which checks its fields by hand (validateFields and
// validateLineItems). Only their own test used them, so they went.
export const SERVICE_CATEGORIES = ['Maintenance', 'Inspection', 'Collision', 'Repair', 'Upgrades', 'Detailing'] as const
