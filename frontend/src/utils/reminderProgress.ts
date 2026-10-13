/**
 * How a pending reminder's progress bar looks and reads. Shared by the
 * reminder list and the vehicle key-facts card so both always agree.
 */

import type { ProgressMeterTone } from '../components/ui'
import type { Reminder } from '../types/reminder'

export type DueStatus = NonNullable<Reminder['due_status']>

/** The bar's colour by how full it is: green, then yellow from 60%, orange
 *  from 80% and red from 95%, so it warms as the due point nears. */
export const fillTone = (share: number): ProgressMeterTone =>
  share >= 0.95 ? 'danger' : share >= 0.8 ? 'warning' : share >= 0.6 ? 'caution' : 'success'

/** A snoozed row stays quiet and an overdue one red, whatever the fill says,
 *  so the bar never contradicts the chip beside it. */
export const meterTone = (status: DueStatus, share: number): ProgressMeterTone =>
  status === 'snoozed' ? 'muted' : status === 'overdue' ? 'danger' : fillTone(share)

/** The bar follows the odometer whenever there's a due mileage, even if the
 *  date is nearer; otherwise the dimension closest to due. */
export function reminderBar(reminder: Reminder): {
  share: number | null
  basis: Reminder['progress_basis']
} {
  return {
    share: reminder.distance_progress ?? reminder.progress ?? null,
    basis: reminder.distance_progress != null ? 'distance' : reminder.progress_basis,
  }
}
