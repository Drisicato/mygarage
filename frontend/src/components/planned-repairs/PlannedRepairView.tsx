/**
 * The whole planned repair, read-only, in a modal centred on screen. Opened
 * by clicking a card on the board; Edit hands over to the form.
 */

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Edit3 } from 'lucide-react'
import { Badge, Button, Chip, Drawer, Mono } from '../ui'
import { supplyEstimate } from './SupplyPartFields'
import { PRIORITY_TONE } from './priorityTone'
import { useSupplies } from '../../hooks/queries/useSupplies'
import { useUnitFormat } from '../../hooks/useUnitFormat'
import { useUnitPreference } from '../../hooks/useUnitPreference'
import { useDateLocale } from '../../hooks/useDateLocale'
import { useCurrencyPreference } from '../../hooks/useCurrencyPreference'
import { formatDateForDisplay } from '../../utils/dateUtils'
import { repairPhotoUrl } from '../../utils/plannedRepairPhoto'
import { formatSupplyQuantity, supplyDisplayUnit } from '../../utils/supplyUnits'
import type { PlannedRepair } from '../../types/plannedRepair'

interface PlannedRepairViewProps {
  repair: PlannedRepair
  onClose: () => void
  onEdit: (repair: PlannedRepair) => void
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-text-mute">{label}</dt>
      <dd className="text-sm text-text text-right min-w-0 break-words">{children}</dd>
    </div>
  )
}

export default function PlannedRepairView({ repair, onClose, onEdit }: PlannedRepairViewProps) {
  const { t } = useTranslation('vehicles')
  const u = useUnitFormat()
  const { system } = useUnitPreference()
  const dateLocale = useDateLocale()
  const { formatCurrency, locale } = useCurrencyPreference()
  const { data: supplyData } = useSupplies(true)
  const supplies = supplyData?.supplies ?? []

  const parts = repair.parts ?? []
  const photos = repair.photos ?? []
  const partCost = (part: (typeof parts)[number]) =>
    part.supply_id != null
      ? supplyEstimate(
          supplies.find((s) => s.id === part.supply_id),
          Number(part.supply_quantity ?? 0),
        )
      : Number(part.cost ?? 0)
  const partsTotal = parts.reduce((sum, p) => sum + partCost(p), 0)

  return (
    <Drawer
      open
      placement="center"
      width="md"
      onClose={onClose}
      title={repair.title}
      closeLabel={t('common:close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common:close')}
          </Button>
          <Button variant="primary" icon={Edit3} onClick={() => onEdit(repair)}>
            {t('common:edit')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone="muted">{t(`plannedRepairs.status.${repair.status}`)}</Chip>
          <Chip tone={PRIORITY_TONE[repair.priority]}>{t(`plannedRepairs.priority.${repair.priority}`)}</Chip>
          {repair.service_category && <Chip tone="muted">{repair.service_category}</Chip>}
          {repair.service_visit_id != null && (
            <Badge tone="success" icon={CheckCircle2}>{t('plannedRepairs.inHistory')}</Badge>
          )}
        </div>

        {repair.description && (
          <section>
            <h3 className="text-sm font-medium text-text mb-1">{t('plannedRepairs.fieldDescription')}</h3>
            <p className="text-sm text-text whitespace-pre-wrap break-words">{repair.description}</p>
          </section>
        )}

        <dl className="divide-y divide-border">
          {repair.estimated_cost != null && (
            <DetailRow label={t('plannedRepairs.fieldEstimate')}>
              <Mono size="sm">{formatCurrency(repair.estimated_cost)}</Mono>
            </DetailRow>
          )}
          {repair.target_date && (
            <DetailRow label={t('plannedRepairs.fieldTargetDate')}>
              <Mono size="sm">{formatDateForDisplay(repair.target_date, undefined, dateLocale)}</Mono>
            </DetailRow>
          )}
          {repair.target_odometer_km != null && (
            <DetailRow label={t('plannedRepairs.fieldTargetOdometer')}>
              <Mono size="sm">{u.distance.format(Number(repair.target_odometer_km))}</Mono>
            </DetailRow>
          )}
          {repair.vendor && <DetailRow label={t('plannedRepairs.fieldShop')}>{repair.vendor.name}</DetailRow>}
          {repair.completed_at && (
            <DetailRow label={t('plannedRepairs.completedOn')}>
              <Mono size="sm">
                {new Date(repair.completed_at).toLocaleDateString(dateLocale, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </Mono>
            </DetailRow>
          )}
        </dl>

        <section>
          <h3 className="text-sm font-medium text-text mb-1">{t('plannedRepairs.parts')}</h3>
          {parts.length === 0 ? (
            <p className="text-xs text-text-mute">{t('plannedRepairs.noParts')}</p>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {parts.map((part) => {
                  const cost = partCost(part)
                  const quantity =
                    part.supply_id != null && part.supply_quantity != null
                      ? formatSupplyQuantity(
                          Number(part.supply_quantity),
                          supplyDisplayUnit(
                            { unit_type: part.unit_type ?? 'count', volume_unit: part.volume_unit ?? null },
                            system,
                          ),
                          locale,
                        )
                      : null
                  return (
                    <li key={part.id} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                      <span className="min-w-0 break-words text-text">
                        {part.supply_name ?? part.description}
                        {quantity && <span className="text-text-mute"> · {quantity}</span>}
                      </span>
                      {cost > 0 && <Mono size="sm">{formatCurrency(cost)}</Mono>}
                    </li>
                  )
                })}
              </ul>
              {partsTotal > 0 && (
                <p className="mt-1 text-xs text-text-mute">
                  {t('plannedRepairs.partsTotal', { total: formatCurrency(partsTotal) })}
                </p>
              )}
            </>
          )}
        </section>

        {photos.length > 0 && (
          <section>
            <h3 className="text-sm font-medium text-text mb-2">{t('plannedRepairs.photos')}</h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {photos.map((photo, index) => (
                <a
                  key={photo.id}
                  href={repairPhotoUrl(repair.vin, repair.id, photo.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="aspect-square overflow-hidden rounded-md border border-border bg-surface-2"
                >
                  <img
                    src={repairPhotoUrl(repair.vin, repair.id, photo.id)}
                    alt={t('plannedRepairs.photoAlt', { number: index + 1, title: repair.title })}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </a>
              ))}
            </div>
          </section>
        )}
      </div>
    </Drawer>
  )
}
