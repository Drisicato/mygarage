/**
 * The whole planned repair, read-only, in a modal centred on screen. Opened
 * by clicking a card on the board; Edit hands over to the form.
 */

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Edit3, ExternalLink } from 'lucide-react'
import { Badge, Button, Chip, Drawer, Mono } from '../ui'
import { supplyEstimate } from './SupplyPartFields'
import { PRIORITY_TONE } from './priorityTone'
import { useSupplies } from '../../hooks/queries/useSupplies'
import { useUnitFormat } from '../../hooks/useUnitFormat'
import { useUnitPreference } from '../../hooks/useUnitPreference'
import { useDateLocale } from '../../hooks/useDateLocale'
import { useCurrencyPreference } from '../../hooks/useCurrencyPreference'
import { formatDateForDisplay } from '../../utils/dateUtils'
import { repairPartImageUrl, repairPhotoUrl } from '../../utils/plannedRepairPhoto'
import { supplyImageUrl } from '../../utils/supplyImage'
import { formatSupplyQuantity, supplyDisplayUnit } from '../../utils/supplyUnits'
import { apiNumber, partLineTotal, partQuantity } from '../../utils/plannedRepairParts'
import { isWebUrl } from '../../utils/partSearch'
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

  const parts = (repair.parts ?? []).filter((p) => p.kind !== 'job')
  const jobs = (repair.parts ?? []).filter((p) => p.kind === 'job')
  const laborTotal = jobs.reduce((sum, job) => sum + Number(job.cost ?? 0), 0)
  const photos = repair.photos ?? []
  const partCost = (part: (typeof parts)[number]) =>
    part.supply_id != null
      ? supplyEstimate(
          supplies.find((s) => s.id === part.supply_id),
          Number(part.supply_quantity ?? 0),
        )
      : partLineTotal(apiNumber(part.cost), apiNumber(part.quantity))
  const partsTotal = parts.reduce((sum, p) => sum + partCost(p), 0)
  /** "2 × $45.50" for a manual part needed more than once; nothing for one. */
  const manualQuantity = (price: number | null, count: number | null) => {
    if (count == null || count === 1) return null
    const quantity = partQuantity(count).toLocaleString(locale)
    return price == null ? quantity : t('plannedRepairs.qtyTimesPrice', { quantity, price: formatCurrency(price) })
  }

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

        {(repair.systems ?? []).length > 0 && (
          <section aria-label={t('plannedRepairs.systems')} className="flex flex-wrap items-center gap-1.5">
            {(repair.systems ?? []).map((key) => (
              <Chip key={key} tone="accent">
                {t(`plannedRepairs.system.${key}`)}
              </Chip>
            ))}
          </section>
        )}

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
          <h3 className="text-sm font-medium text-text mb-1">{t('plannedRepairs.partsSection')}</h3>
          {parts.length === 0 ? (
            <p className="text-xs text-text-mute">{t('plannedRepairs.noParts')}</p>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {parts.map((part) => {
                  const cost = partCost(part)
                  const isSupply = part.supply_id != null
                  const price = apiNumber(part.cost)
                  const count = apiNumber(part.quantity)
                  const quantity =
                    isSupply && part.supply_quantity != null
                      ? formatSupplyQuantity(
                          Number(part.supply_quantity),
                          supplyDisplayUnit(
                            { unit_type: part.unit_type ?? 'count', volume_unit: part.volume_unit ?? null },
                            system,
                          ),
                          locale,
                        )
                      : manualQuantity(price, count)
                  const url = part.url && isWebUrl(part.url) ? part.url : null
                  // A supply part shows the supply's own picture.
                  const supply = isSupply ? supplies.find((s) => s.id === part.supply_id) : undefined
                  const imageUrl = part.has_image
                    ? repairPartImageUrl(repair.vin, repair.id, part.id, part.image_version)
                    : supply?.has_image
                      ? supplyImageUrl(supply.id, supply.updated_at)
                      : null
                  return (
                    <li key={part.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                      {imageUrl && (
                        <a
                          href={imageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-md border border-border bg-surface-2"
                        >
                          <img
                            src={imageUrl}
                            alt={t('plannedRepairs.partImageAlt', { name: part.supply_name ?? part.description })}
                            loading="lazy"
                            className="h-full w-full object-contain"
                          />
                        </a>
                      )}
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="break-words text-text">
                          {part.supply_name ?? part.description}
                          {quantity && <span className="text-text-mute"> · {quantity}</span>}
                        </p>
                        {(part.part_number || url) && (
                          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-mute">
                            {part.part_number && (
                              <Mono size="xs">{t('plannedRepairs.partNumberShort', { value: part.part_number })}</Mono>
                            )}
                            {url && (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-(--accent-fg) hover:underline"
                              >
                                <ExternalLink aria-hidden="true" className="h-3 w-3" />
                                {t('plannedRepairs.openLink')}
                              </a>
                            )}
                          </p>
                        )}
                      </div>
                      {cost > 0 && <Mono size="sm">{formatCurrency(cost)}</Mono>}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </section>

        <section>
          <h3 className="text-sm font-medium text-text mb-1">{t('plannedRepairs.jobsSection')}</h3>
          {jobs.length === 0 ? (
            <p className="text-xs text-text-mute">{t('plannedRepairs.noJobs')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {jobs.map((job) => (
                <li key={job.id} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                  <span className="min-w-0 break-words text-text">{job.description}</span>
                  {Number(job.cost ?? 0) > 0 && <Mono size="sm">{formatCurrency(job.cost ?? 0)}</Mono>}
                </li>
              ))}
            </ul>
          )}
          {partsTotal + laborTotal > 0 && (
            <p className="mt-1 text-xs text-text-mute">
              {t('plannedRepairs.partsAndLaborTotal', {
                parts: formatCurrency(partsTotal, { zeroIsValid: true }),
                labor: formatCurrency(laborTotal, { zeroIsValid: true }),
                total: formatCurrency(partsTotal + laborTotal),
              })}
            </p>
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
