/**
 * Three columns, Planning -> In Progress -> Done. Cards drag between and
 * within columns (mouse, touch, or keyboard via dnd-kit's sensors); each
 * card's menu does the same moves without dragging. Clicking a card opens
 * its read-only view.
 *
 * The system filter only hides cards: a drop still lands at its place in the
 * whole column, hidden cards included.
 *
 * The board only reports intent. Whether a move into Done needs the
 * completion dialog first is decided by the tab, which owns that dialog.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import { Badge, Mono, Select } from '../ui'
import { useCurrencyPreference } from '../../hooks/useCurrencyPreference'
import PlannedRepairCard, { cardDndId } from './PlannedRepairCard'
import {
  REPAIR_STATUSES,
  VEHICLE_SYSTEMS,
  type PlannedRepair,
  type RepairStatus,
  type VehicleSystem,
} from '../../types/plannedRepair'

const columnDndId = (status: RepairStatus) => `column:${status}`

/** Prefer the card under the pointer over the column around it. */
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  const found = hits.length > 0 ? hits : rectIntersection(args)
  const card = found.find((hit) => String(hit.id).startsWith('repair:'))
  return card ? [card] : found
}

interface ColumnProps {
  status: RepairStatus
  repairs: PlannedRepair[]
  onView: (repair: PlannedRepair) => void
  onEdit: (repair: PlannedRepair) => void
  onDelete: (repair: PlannedRepair) => void
  onMoveTo: (repair: PlannedRepair, status: RepairStatus) => void
}

function Column({ status, repairs, onView, onEdit, onDelete, onMoveTo }: ColumnProps) {
  const { t } = useTranslation('vehicles')
  const { formatCurrency } = useCurrencyPreference()
  const { setNodeRef, isOver } = useDroppable({ id: columnDndId(status) })
  const total = repairs.reduce((sum, r) => sum + Number(r.estimated_cost ?? 0), 0)
  const heading = t(`plannedRepairs.status.${status}`)

  return (
    <section
      ref={setNodeRef}
      aria-label={heading}
      className={`flex flex-col rounded-lg border p-3 min-h-[160px] transition-colors ${
        isOver ? 'border-(--accent-line) bg-(--accent-soft)' : 'border-border bg-surface-2'
      }`}
    >
      <header className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-text">{heading}</h3>
          <Badge count={repairs.length} tone="muted" />
        </div>
        {total > 0 && <Mono size="sm" tone="muted">{formatCurrency(total)}</Mono>}
      </header>
      <div className="flex flex-col gap-2 flex-1">
        {repairs.length === 0 ? (
          <p className="text-xs text-text-mute text-center py-6">{t('plannedRepairs.emptyColumn')}</p>
        ) : (
          repairs.map((repair) => (
            <PlannedRepairCard
              key={repair.id}
              repair={repair}
              onView={onView}
              onEdit={onEdit}
              onDelete={onDelete}
              onMoveTo={onMoveTo}
            />
          ))
        )}
      </div>
    </section>
  )
}

interface PlannedRepairBoardProps {
  repairs: PlannedRepair[]
  /** A click on a card that wasn't the end of a drag. */
  onView: (repair: PlannedRepair) => void
  onEdit: (repair: PlannedRepair) => void
  onDelete: (repair: PlannedRepair) => void
  /** A move to `status` at `position` (zero-based within that column). */
  onMove: (repair: PlannedRepair, status: RepairStatus, position: number) => void
}

export default function PlannedRepairBoard({ repairs, onView, onEdit, onDelete, onMove }: PlannedRepairBoardProps) {
  const { t } = useTranslation('vehicles')
  const [systemFilter, setSystemFilter] = useState<VehicleSystem | ''>('')
  // Only the systems some repair carries, so the filter never offers an empty board.
  const usedSystems = useMemo(
    () => VEHICLE_SYSTEMS.filter((key) => repairs.some((r) => r.systems?.includes(key))),
    [repairs],
  )
  const activeFilter = systemFilter && usedSystems.includes(systemFilter) ? systemFilter : ''
  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so clicks on a card's
    // menu still register as clicks.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Touch waits for a press-and-hold so the page still scrolls.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const columns = useMemo(() => {
    const byStatus: Record<RepairStatus, PlannedRepair[]> = { planning: [], in_progress: [], done: [] }
    for (const repair of repairs) byStatus[repair.status]?.push(repair)
    for (const status of REPAIR_STATUSES) byStatus[status].sort((a, b) => a.position - b.position || a.id - b.id)
    return byStatus
  }, [repairs])

  const visibleColumns = useMemo(() => {
    if (!activeFilter) return columns
    const shown = (list: PlannedRepair[]) => list.filter((r) => r.systems?.includes(activeFilter))
    return { planning: shown(columns.planning), in_progress: shown(columns.in_progress), done: shown(columns.done) }
  }, [columns, activeFilter])

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return
    const repair = repairs.find((r) => cardDndId(r.id) === active.id)
    if (!repair) return

    const overId = String(over.id)
    let status: RepairStatus
    let position: number
    if (overId.startsWith('column:')) {
      status = overId.slice('column:'.length) as RepairStatus
      position = columns[status].filter((r) => r.id !== repair.id).length
    } else {
      const target = repairs.find((r) => cardDndId(r.id) === overId)
      if (!target || target.id === repair.id) return
      status = target.status
      position = columns[status].filter((r) => r.id !== repair.id).findIndex((r) => r.id === target.id)
    }

    const currentIndex = columns[repair.status].findIndex((r) => r.id === repair.id)
    if (status === repair.status && position === currentIndex) return
    onMove(repair, status, position)
  }

  const moveTo = (repair: PlannedRepair, status: RepairStatus) => {
    onMove(repair, status, columns[status].length)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={handleDragEnd}>
      {usedSystems.length > 0 && (
        <div className="mb-3 flex justify-end">
          <div className="w-full sm:w-56">
            <Select
              aria-label={t('plannedRepairs.filterBySystem')}
              value={activeFilter}
              onChange={(e) => setSystemFilter(e.target.value as VehicleSystem | '')}
              placeholder={t('plannedRepairs.allSystems')}
              options={usedSystems.map((key) => ({ value: key, label: t(`plannedRepairs.system.${key}`) }))}
            />
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {REPAIR_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            repairs={visibleColumns[status]}
            onView={onView}
            onEdit={onEdit}
            onDelete={onDelete}
            onMoveTo={moveTo}
          />
        ))}
      </div>
    </DndContext>
  )
}
