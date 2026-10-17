import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronDown, ChevronUp, ClipboardPlus, Edit3, Gauge, Trash2, User, Wind } from 'lucide-react'
import { Badge, Button, Card, Chip, IconButton, Mono } from '../ui'
import type { Tone } from '../ui'
import { useUnitFormat } from '../../hooks/useUnitFormat'
import { useDateLocale } from '../../hooks/useDateLocale'
import { formatDateForDisplay } from '../../utils/dateUtils'
import { UNIT_ADAPTERS } from '../../utils/unitAdapters'
import { ALL_ITEM_KEYS, cornerLabelKey, inspectionPhotoUrl, itemLabelKey } from '../../utils/inspectionChecklist'
import {
  INSPECTION_CORNERS,
  type InspectionCornerPosition,
  type InspectionCornerReading,
  type InspectionPointStatus,
  type VehicleInspection,
  type VehicleInspectionItem,
} from '../../types/vehicleInspection'

const STATUS_TONE: Record<InspectionPointStatus, Tone> = {
  green: 'success',
  yellow: 'warning',
  red: 'danger',
  not_inspected: 'muted',
}

/** Brake pads are read in mm whatever the tread unit, matching the form's gauge. */
const formatPadMm = (mm: string | number) => `${Number(mm)} ${UNIT_ADAPTERS.mm.label}`

/** Sheet order, so the attention list reads like the form. */
const SHEET_INDEX = new Map(ALL_ITEM_KEYS.map((key, index) => [key as string, index]))

interface InspectionCardProps {
  inspection: VehicleInspection
  onEdit: (inspection: VehicleInspection) => void
  onDelete: (inspection: VehicleInspection) => void
  onCreateRepair: (inspection: VehicleInspection, item: VehicleInspectionItem) => void
  onCreateCornerRepair: (
    inspection: VehicleInspection,
    position: InspectionCornerPosition,
    reading: InspectionCornerReading,
    title: string,
  ) => void
  /** The row whose repair is being created (an item key, or `position:reading`), to show its button busy. */
  creatingItemKey?: string | null
}

/** The key a red wheel reading's row goes by while its repair is created. */
export const cornerRowKey = (position: InspectionCornerPosition, reading: InspectionCornerReading) =>
  `${position}:${reading}`

/** One row of the attention list: a checklist point or a red tire/brake reading. */
interface AttentionRow {
  key: string
  status: InspectionPointStatus
  label: string
  detail?: string | null
  linked: boolean
  create: () => void
}

export default function InspectionCard({
  inspection,
  onEdit,
  onDelete,
  onCreateRepair,
  onCreateCornerRepair,
  creatingItemKey,
}: InspectionCardProps) {
  const { t } = useTranslation('vehicles')
  const u = useUnitFormat()
  const dateLocale = useDateLocale()
  const [expanded, setExpanded] = useState(false)

  const date = formatDateForDisplay(inspection.date, undefined, dateLocale)
  const counts = inspection.counts ?? { green: 0, yellow: 0, red: 0, not_inspected: 0 }
  const attention = (inspection.items ?? [])
    .filter((i) => i.status === 'red' || i.status === 'yellow')
    .sort(
      (a, b) =>
        (a.status === 'red' ? 0 : 1) - (b.status === 'red' ? 0 : 1) ||
        (SHEET_INDEX.get(a.item_key) ?? 99) - (SHEET_INDEX.get(b.item_key) ?? 99),
    )
  const corners = INSPECTION_CORNERS.map((position) =>
    (inspection.corners ?? []).find((c) => c.position === position),
  ).filter((c) => c !== undefined)
  const photos = inspection.photos ?? []
  const itemRows: AttentionRow[] = attention.map((item) => ({
    key: item.item_key,
    status: item.status,
    label: t(itemLabelKey(item.item_key)),
    detail: item.note,
    linked: item.planned_repair_id != null,
    create: () => onCreateRepair(inspection, item),
  }))
  // A red tire or brake pad needs replacing now, so it gets a repair button like a red point.
  const cornerRows: AttentionRow[] = corners.flatMap((c) => {
    const wheel = t(cornerLabelKey(c.position))
    const rows: AttentionRow[] = []
    if (c.tread_status === 'red') {
      rows.push({
        key: cornerRowKey(c.position, 'tread'),
        status: 'red',
        label: t('vehicleInspections.tireAt', { corner: wheel }),
        detail: c.tread_depth_mm != null ? u.tread.format(Number(c.tread_depth_mm)) : null,
        linked: c.tread_repair_id != null,
        create: () => onCreateCornerRepair(inspection, c.position, 'tread', t('vehicleInspections.tireRepairTitle', { corner: wheel })),
      })
    }
    if (c.brake_status === 'red') {
      rows.push({
        key: cornerRowKey(c.position, 'brake'),
        status: 'red',
        label: t('vehicleInspections.brakeAt', { corner: wheel }),
        detail: c.brake_pad_mm != null ? formatPadMm(c.brake_pad_mm) : null,
        linked: c.brake_repair_id != null,
        create: () => onCreateCornerRepair(inspection, c.position, 'brake', t('vehicleInspections.brakeRepairTitle', { corner: wheel })),
      })
    }
    return rows
  })
  // Red first (points, then wheels), then the yellow points.
  const rows = [...itemRows.filter((r) => r.status === 'red'), ...cornerRows, ...itemRows.filter((r) => r.status !== 'red')]
  const pressure = (kpa: string | number | null | undefined) => (kpa != null ? u.pressure.format(Number(kpa)) : '—')
  const hasPressure = inspection.tire_pressure_front_kpa != null || inspection.tire_pressure_rear_kpa != null
  const detailsId = `inspection-details-${inspection.id}`

  return (
    <Card padding="sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h4 className="text-sm font-semibold text-text">{t('vehicleInspections.cardTitle', { date })}</h4>
          <div className="flex flex-wrap items-center gap-3 text-xs text-text-mute">
            {inspection.odometer_km != null && (
              <span className="flex items-center gap-1">
                <Gauge aria-hidden="true" className="w-3.5 h-3.5" />
                <Mono size="sm" tone="muted">{u.distance.format(Number(inspection.odometer_km))}</Mono>
              </span>
            )}
            {inspection.inspector && (
              <span className="flex items-center gap-1">
                <User aria-hidden="true" className="w-3.5 h-3.5" />
                <span className="truncate">{inspection.inspector}</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            icon={Edit3}
            label={t('vehicleInspections.editLabel', { date })}
            variant="ghost"
            size="sm"
            onClick={() => onEdit(inspection)}
          />
          <IconButton
            icon={Trash2}
            label={t('vehicleInspections.deleteLabel', { date })}
            variant="ghost"
            size="sm"
            onClick={() => onDelete(inspection)}
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Chip tone="success">{t('vehicleInspections.countGreen', { count: counts.green })}</Chip>
        <Chip tone="warning">{t('vehicleInspections.countYellow', { count: counts.yellow })}</Chip>
        <Chip tone="danger">{t('vehicleInspections.countRed', { count: counts.red })}</Chip>
      </div>

      <div className="mt-2">
        <Button
          variant="ghost"
          size="sm"
          icon={expanded ? ChevronUp : ChevronDown}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={detailsId}
        >
          {expanded ? t('vehicleInspections.hideDetails') : t('vehicleInspections.showDetails')}
        </Button>
      </div>

      {expanded && (
        <div id={detailsId} className="mt-2 space-y-3 text-sm">
          {rows.length === 0 ? (
            <p className="text-xs text-text-mute">{t('vehicleInspections.noAttention')}</p>
          ) : (
            <ul className="divide-y divide-border-soft">
              {rows.map((row) => (
                <li key={row.key} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Chip tone={STATUS_TONE[row.status]}>{t(`vehicleInspections.status.${row.status}`)}</Chip>
                      <span className="text-text">{row.label}</span>
                    </div>
                    {row.detail && <p className="text-xs text-text-mute whitespace-pre-wrap">{row.detail}</p>}
                  </div>
                  {row.linked ? (
                    <Badge tone="success" icon={CheckCircle2}>{t('vehicleInspections.repairCreated')}</Badge>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={ClipboardPlus}
                      loading={creatingItemKey === row.key}
                      disabled={!!creatingItemKey}
                      onClick={row.create}
                    >
                      {t('vehicleInspections.createRepair')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {hasPressure && (
            <p className="flex items-center gap-1.5 text-xs text-text-mute">
              <Wind aria-hidden="true" className="w-3.5 h-3.5" />
              <span>
                {t('vehicleInspections.pressureSummary', {
                  front: pressure(inspection.tire_pressure_front_kpa),
                  rear: pressure(inspection.tire_pressure_rear_kpa),
                })}
              </span>
            </p>
          )}

          {corners.length > 0 && (
            <table className="w-full text-xs">
              <caption className="sr-only">{t('vehicleInspections.cornerSummary')}</caption>
              <thead className="text-text-mute">
                <tr>
                  <th scope="col" className="text-left font-medium py-1">{t('vehicleInspections.wheel')}</th>
                  <th scope="col" className="text-left font-medium py-1">{t('vehicleInspections.treadDepth')}</th>
                  <th scope="col" className="text-left font-medium py-1">{t('vehicleInspections.brakePadShort')}</th>
                </tr>
              </thead>
              <tbody>
                {corners.map((c) => (
                  <tr key={c.position} className="border-t border-border-soft">
                    <th scope="row" className="text-left font-normal py-1 text-text">{t(cornerLabelKey(c.position))}</th>
                    <td className="py-1">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className={`inline-block h-2 w-2 rounded-full ${dotClass(c.tread_status)}`}
                        />
                        <span className="sr-only">{t(`vehicleInspections.status.${c.tread_status}`)}</span>
                        <Mono size="sm">{c.tread_depth_mm != null ? u.tread.format(Number(c.tread_depth_mm)) : '—'}</Mono>
                      </span>
                    </td>
                    <td className="py-1">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className={`inline-block h-2 w-2 rounded-full ${dotClass(c.brake_status)}`}
                        />
                        <span className="sr-only">{t(`vehicleInspections.status.${c.brake_status}`)}</span>
                        <Mono size="sm">{c.brake_pad_mm != null ? formatPadMm(c.brake_pad_mm) : '—'}</Mono>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {inspection.recommendations && (
            <div>
              <h5 className="text-xs font-medium text-text-mute">{t('vehicleInspections.recommendations')}</h5>
              <p className="text-sm text-text whitespace-pre-wrap">{inspection.recommendations}</p>
            </div>
          )}

          {photos.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {photos.map((photo, index) => (
                <a
                  key={photo.id}
                  href={inspectionPhotoUrl(inspection.vin, inspection.id, photo.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-14 w-14 overflow-hidden rounded-md border border-border bg-surface-2"
                >
                  <img
                    src={inspectionPhotoUrl(inspection.vin, inspection.id, photo.id)}
                    alt={t('vehicleInspections.photoAlt', { number: index + 1 })}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function dotClass(status: InspectionPointStatus): string {
  switch (status) {
    case 'green':
      return 'bg-success'
    case 'yellow':
      return 'bg-warning'
    case 'red':
      return 'bg-danger'
    default:
      return 'bg-text-mute/40'
  }
}
