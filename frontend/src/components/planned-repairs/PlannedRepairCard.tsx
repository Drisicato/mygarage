import { useTranslation } from 'react-i18next'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { ArrowRight, Calendar, CheckCircle2, Edit3, Gauge, MoreVertical, Package, Store, Trash2 } from 'lucide-react'
import { Badge, Card, Chip, Dropdown, Mono } from '../ui'
import type { DropdownItem, Tone } from '../ui'
import { useUnitFormat } from '../../hooks/useUnitFormat'
import { useDateLocale } from '../../hooks/useDateLocale'
import { useCurrencyPreference } from '../../hooks/useCurrencyPreference'
import { formatDateForDisplay } from '../../utils/dateUtils'
import {
  REPAIR_STATUSES,
  type PlannedRepair,
  type RepairPriority,
  type RepairStatus,
} from '../../types/plannedRepair'

const PRIORITY_TONE: Record<RepairPriority, Tone> = {
  low: 'muted',
  medium: 'info',
  high: 'warning',
  urgent: 'danger',
}

/** The id dnd-kit tracks a card by, shared with the board's drop handling. */
export const cardDndId = (id: number) => `repair:${id}`

interface PlannedRepairCardProps {
  repair: PlannedRepair
  onEdit: (repair: PlannedRepair) => void
  onDelete: (repair: PlannedRepair) => void
  onMoveTo: (repair: PlannedRepair, status: RepairStatus) => void
}

export default function PlannedRepairCard({ repair, onEdit, onDelete, onMoveTo }: PlannedRepairCardProps) {
  const { t } = useTranslation('vehicles')
  const u = useUnitFormat()
  const dateLocale = useDateLocale()
  const { formatCurrency } = useCurrencyPreference()

  const dndId = cardDndId(repair.id)
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({ id: dndId })
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: dndId })
  const setRef = (node: HTMLElement | null) => {
    setDragRef(node)
    setDropRef(node)
  }

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : undefined

  const menuItems: DropdownItem[] = [
    ...REPAIR_STATUSES.filter((s) => s !== repair.status).map((status) => ({
      id: `move-${status}`,
      label: t('plannedRepairs.moveTo', { stage: t(`plannedRepairs.status.${status}`) }),
      icon: status === 'done' ? CheckCircle2 : ArrowRight,
      onSelect: () => onMoveTo(repair, status),
    })),
    { id: 'edit', label: t('common:edit'), icon: Edit3, onSelect: () => onEdit(repair) },
    { id: 'delete', label: t('common:delete'), icon: Trash2, onSelect: () => onDelete(repair) },
  ]

  const cost = repair.estimated_cost != null ? formatCurrency(repair.estimated_cost) : null
  const partCount = repair.parts?.length ?? 0
  const supplyCount = repair.parts?.filter((p) => p.supply_id != null).length ?? 0

  return (
    <div
      ref={setRef}
      style={style}
      className={`touch-manipulation ${isDragging ? 'opacity-70 shadow-lg' : ''} ${
        isOver && !isDragging ? 'border-t-2 border-(--accent-line) pt-1' : ''
      }`}
      {...attributes}
      {...listeners}
      aria-roledescription={t('plannedRepairs.draggableCard')}
    >
      <Card padding="sm" className="cursor-grab active:cursor-grabbing">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-medium text-text break-words min-w-0">{repair.title}</h4>
          <div onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Dropdown
              label={t('plannedRepairs.actions', { title: repair.title })}
              items={menuItems}
              align="right"
              trigger={<MoreVertical aria-hidden="true" className="w-4 h-4" />}
            />
          </div>
        </div>

        {repair.description && (
          <p className="mt-1 text-xs text-text-mute line-clamp-2 whitespace-pre-wrap">{repair.description}</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Chip tone={PRIORITY_TONE[repair.priority]}>{t(`plannedRepairs.priority.${repair.priority}`)}</Chip>
          {repair.service_category && <Chip tone="muted">{repair.service_category}</Chip>}
          {repair.service_visit_id != null && (
            <Badge tone="success" icon={CheckCircle2}>{t('plannedRepairs.inHistory')}</Badge>
          )}
        </div>

        <div className="mt-2 space-y-1 text-xs text-text-mute">
          {cost && (
            <div className="flex items-center justify-between">
              <span>{t('plannedRepairs.estimate')}</span>
              <Mono size="sm">{cost}</Mono>
            </div>
          )}
          {repair.target_date && (
            <div className="flex items-center gap-1.5">
              <Calendar aria-hidden="true" className="w-3.5 h-3.5" />
              <Mono size="sm" tone="muted">{formatDateForDisplay(repair.target_date, undefined, dateLocale)}</Mono>
            </div>
          )}
          {repair.target_odometer_km != null && (
            <div className="flex items-center gap-1.5">
              <Gauge aria-hidden="true" className="w-3.5 h-3.5" />
              <Mono size="sm" tone="muted">{u.distance.format(Number(repair.target_odometer_km))}</Mono>
            </div>
          )}
          {repair.vendor && (
            <div className="flex items-center gap-1.5">
              <Store aria-hidden="true" className="w-3.5 h-3.5" />
              <span className="truncate">{repair.vendor.name}</span>
            </div>
          )}
          {partCount > 0 && (
            <div className="flex items-center gap-1.5">
              <Package aria-hidden="true" className="w-3.5 h-3.5" />
              <span>
                {t('plannedRepairs.partCount', { count: partCount })}
                {supplyCount > 0 && ` · ${t('plannedRepairs.fromSupplies', { count: supplyCount })}`}
              </span>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
