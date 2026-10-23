import type { Tone } from '../ui'
import type { RepairPriority } from '../../types/plannedRepair'

/** Chip tone for each priority, shared by the board card and the view. */
export const PRIORITY_TONE: Record<RepairPriority, Tone> = {
  low: 'muted',
  medium: 'info',
  high: 'warning',
  urgent: 'danger',
}
