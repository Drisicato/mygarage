import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Wrench, Fuel, DollarSign, Bell } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { VehicleDetailStats } from '../../types/vehicle'
import { useCurrencyPreference } from '../../hooks/useCurrencyPreference'
import { useDateLocale } from '../../hooks/useDateLocale'
import { formatCurrency } from '../../utils/formatUtils'
import { formatDateForDisplay } from '../../utils/dateUtils'
import { useReminders } from '../../hooks/useReminders'
import { useReminderRemaining } from '../../hooks/useReminderRemaining'
import {
  chooseKeyFactReminder, readKeyFactReminder, rememberKeyFactReminder,
} from '../../utils/keyFactReminder'
import { meterTone, reminderBar } from '../../utils/reminderProgress'
import { Mono, ProgressMeter, Select } from '../ui'

interface VehicleKeyFactsProps {
  vin: string
  stats: VehicleDetailStats
}

/**
 * Vehicle Detail key-facts strip (P5 Task 5). Bespoke hairline grid (G4 (b)) —
 * four cells: Last Service / Last Fill-up / Spent {year} / Upcoming. The
 * odometer reading and overdue count live in the hero (Task 3), so this strip
 * renders the remaining four contract fields (each shown exactly once).
 */
export default function VehicleKeyFacts({ vin, stats }: VehicleKeyFactsProps) {
  const { t } = useTranslation('vehicles')
  const remainingText = useReminderRemaining()
  const { data: reminders = [] } = useReminders(vin, 'pending')
  const [savedId, setSavedId] = useState<number | null>(() => readKeyFactReminder(vin))
  const pending = reminders.filter((r) => r.status === 'pending')
  const reminder = chooseKeyFactReminder(pending, savedId)
  const { share, basis } = reminder ? reminderBar(reminder) : { share: null, basis: undefined }
  const status = reminder?.due_status ?? null
  const remaining = reminder ? remainingText(reminder, basis) : null
  const pick = (id: number) => {
    setSavedId(id)
    rememberKeyFactReminder(vin, id)
  }
  const { currencyCode, locale } = useCurrencyPreference()
  const dateLocale = useDateLocale()

  const fmtDate = (d: string | null | undefined): string =>
    d
      ? formatDateForDisplay(d, { year: 'numeric', month: 'short', day: 'numeric' }, dateLocale)
      : t('detail.notSpecified')

  // Each cell is a role="group" whose accessible name is its label (B9). The
  // value lives inside that group, so a test can bind value↔label with
  // `within(getByRole('group', { name: label }))` — swapping last_service_date
  // and last_fillup_date then fails, which a bare getByText could not catch.
  const cell = (icon: LucideIcon, ariaLabel: string, label: ReactNode, value: ReactNode) => {
    const Icon = icon
    return (
      <div role="group" aria-label={ariaLabel} className="flex items-center gap-3 bg-surface px-4 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-surface-2 text-text-mute">
          <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-text">{value}</div>
          <div className="mt-0.5 text-[11px] text-text-mute">{label}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-panel border border-border bg-hair sm:grid-cols-2 lg:grid-cols-4">
      {reminder ? (
        <div role="group" aria-label={t('detail.keyFacts.reminder')} className="flex items-center gap-3 bg-surface px-4 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-surface-2 text-text-mute">
            <Wrench aria-hidden="true" className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            {pending.length > 1 ? (
              <Select
                size="sm"
                aria-label={t('detail.keyFacts.pickReminder')}
                value={reminder.id}
                onChange={(e) => pick(Number(e.target.value))}
                options={pending.map((r) => ({ value: String(r.id), label: r.title }))}
              />
            ) : (
              <div className="truncate text-[15px] font-semibold text-text">{reminder.title}</div>
            )}
            {share != null && status ? (
              <div className="mt-1.5 flex items-center gap-2">
                <ProgressMeter
                  className="flex-1"
                  label={t('reminderList.progressLabel', { title: reminder.title })}
                  percent={share * 100}
                  tone={meterTone(status, share)}
                  valueText={remaining ?? undefined}
                />
                {remaining && <span className="text-[11px] whitespace-nowrap text-text-mute">{remaining}</span>}
              </div>
            ) : (
              <div className="mt-0.5 text-[11px] text-text-mute">{remaining ?? t('detail.notSpecified')}</div>
            )}
          </div>
        </div>
      ) : (
        cell(
          Wrench,
          t('vehicleStats.lastService'),
          t('vehicleStats.lastService'),
          <Mono size="lg" weight="semibold">{fmtDate(stats.last_service_date)}</Mono>,
        )
      )}
      {cell(
        Fuel,
        t('vehicleStats.lastFillUp'),
        t('vehicleStats.lastFillUp'),
        <Mono size="lg" weight="semibold">{fmtDate(stats.last_fillup_date)}</Mono>,
      )}
      {cell(
        DollarSign,
        t('detail.keyFacts.spent'),
        <>{t('detail.keyFacts.spent')} {stats.year}</>,
        <Mono size="lg" weight="semibold">{formatCurrency(stats.spent_this_year, { currencyCode, locale, zeroIsValid: true })}</Mono>,
      )}
      {cell(Bell, t('detail.keyFacts.upcoming'), t('detail.keyFacts.upcoming'), <Mono size="lg" weight="semibold">{stats.upcoming_count}</Mono>)}
    </div>
  )
}
