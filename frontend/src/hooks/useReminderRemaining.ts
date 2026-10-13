import { useTranslation } from 'react-i18next'
import type { Reminder } from '../types/reminder'
import { useUnitFormat } from './useUnitFormat'

/** What is left along the dimension a reminder's bar measures, in the vehicle's units. */
export function useReminderRemaining() {
  const { t } = useTranslation('vehicles')
  const u = useUnitFormat()
  return (reminder: Reminder, basis: Reminder['progress_basis']): string | null => {
    switch (basis) {
      case 'distance': {
        if (reminder.km_until_due == null) return null
        const km = Number(reminder.km_until_due)
        const distance = u.distance.format(Math.abs(km))
        return km < 0
          ? t('reminderList.distanceOver', { distance })
          : t('reminderList.distanceLeft', { distance })
      }
      case 'hours': {
        if (reminder.hours_until_due == null) return null
        const hours = Number(reminder.hours_until_due)
        const n = Math.abs(hours).toFixed(1)
        return hours < 0 ? t('reminderList.hoursOver', { n }) : t('reminderList.hoursLeft', { n })
      }
      case 'date': {
        const days = reminder.days_until_due
        if (days == null) return null
        if (days === 0) return t('reminderList.dueToday')
        return days < 0
          ? t('reminderList.daysOverdue', { count: -days })
          : t('reminderList.daysLeft', { count: days })
      }
      default:
        return null
    }
  }
}
