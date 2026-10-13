/**
 * Which reminder the vehicle key-facts card tracks. The pick is kept per
 * vehicle in this browser: it is layout taste, not household data. Every
 * storage access is guarded because storage throws in a private window or
 * with site data blocked.
 */

import type { Reminder } from '../types/reminder'

const DEFAULT_TYPE = 'engine_oil_filter'

const key = (vin: string) => `mygarage:vehicle:${vin}:keyfact-reminder`

export function readKeyFactReminder(vin: string): number | null {
  try {
    const raw = localStorage.getItem(key(vin))
    if (raw === null) return null
    const id = Number(raw)
    return Number.isInteger(id) ? id : null
  } catch {
    return null
  }
}

export function rememberKeyFactReminder(vin: string, id: number | null): void {
  try {
    if (id === null) localStorage.removeItem(key(vin))
    else localStorage.setItem(key(vin), String(id))
  } catch {
    // Not remembering the pick is a smaller failure than breaking the page.
  }
}

/** Soonest first: a due date sorts by itself, a reminder without one last. */
const dueOrder = (a: Reminder, b: Reminder): number =>
  (a.due_date ?? '9999-12-31').localeCompare(b.due_date ?? '9999-12-31')

/**
 * The reminder to show: the saved pick if it is still pending, else the
 * vehicle's oil and filter change, else whichever is due soonest. Null when
 * the vehicle has no pending reminder.
 */
export function chooseKeyFactReminder(reminders: Reminder[], savedId: number | null): Reminder | null {
  const pending = reminders.filter((r) => r.status === 'pending')
  return (
    pending.find((r) => r.id === savedId) ??
    pending.find((r) => r.maintenance_type === DEFAULT_TYPE) ??
    [...pending].sort(dueOrder)[0] ??
    null
  )
}
