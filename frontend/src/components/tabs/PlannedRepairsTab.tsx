import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardList, Plus } from 'lucide-react'
import { toast } from 'sonner'
import api from '../../services/api'
import PlannedRepairBoard from '../planned-repairs/PlannedRepairBoard'
import PlannedRepairForm from '../planned-repairs/PlannedRepairForm'
import CompleteRepairDialog from '../planned-repairs/CompleteRepairDialog'
import { Button, EmptyState } from '../ui'
import {
  useDeletePlannedRepair,
  useMovePlannedRepair,
  usePlannedRepairs,
} from '../../hooks/queries/usePlannedRepairs'
import { useLatestMileage } from '../../hooks/useLatestMileage'
import { useLatestHours } from '../../hooks/useLatestHours'
import { getUsageTracking } from '../../utils/usageTracking'
import { getActionErrorMessage } from '../../utils/httpErrorHandler'
import type { Vehicle } from '../../types/vehicle'
import type { PlannedRepair, RepairStatus } from '../../types/plannedRepair'

interface PlannedRepairsTabProps {
  vin: string
}

export default function PlannedRepairsTab({ vin }: PlannedRepairsTabProps) {
  const { t } = useTranslation('vehicles')
  const { data, isLoading, error } = usePlannedRepairs(vin)
  const moveMutation = useMovePlannedRepair(vin)
  const deleteMutation = useDeletePlannedRepair(vin)
  const { data: currentMileage } = useLatestMileage(vin)
  const { data: currentHours } = useLatestHours(vin)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<PlannedRepair | undefined>()
  const [completing, setCompleting] = useState<PlannedRepair | undefined>()
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)

  useEffect(() => {
    let cancelled = false
    void api
      .get(`/vehicles/${vin}`)
      .then((res) => {
        if (!cancelled) setVehicle(res.data ?? null)
      })
      .catch(() => {
        if (!cancelled) setVehicle(null)
      })
    return () => {
      cancelled = true
    }
  }, [vin])

  const { tracksDistance, tracksHours } = getUsageTracking({
    usage_unit: vehicle?.usage_unit,
    secondary_usage_enabled: vehicle?.secondary_usage_enabled,
  })

  const repairs = data?.repairs ?? []

  const handleMove = (repair: PlannedRepair, status: RepairStatus, position: number) => {
    // Done means it's in service history. A repair that never logged its
    // visit goes through the dialog; one that did (moved back out by
    // mistake) just moves, and the backend reuses that visit.
    if (status === 'done' && repair.status !== 'done' && repair.service_visit_id == null) {
      setCompleting(repair)
      return
    }
    moveMutation.mutate(
      { id: repair.id, status, position },
      { onError: (err) => toast.error(getActionErrorMessage(err, t('plannedRepairs.moveAction'))) },
    )
  }

  const handleDelete = (repair: PlannedRepair) => {
    const message =
      repair.service_visit_id != null
        ? t('plannedRepairs.confirmDeleteKeepsHistory', { title: repair.title })
        : t('plannedRepairs.confirmDelete', { title: repair.title })
    if (!confirm(message)) return
    deleteMutation.mutate(repair.id, {
      onError: (err) => toast.error(getActionErrorMessage(err, t('plannedRepairs.deleteAction'))),
    })
  }

  const openCreate = () => {
    setEditing(undefined)
    setShowForm(true)
  }

  const openEdit = (repair: PlannedRepair) => {
    setEditing(repair)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditing(undefined)
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[200px]">
        <div className="text-text-mute">{t('plannedRepairs.loading')}</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-danger/10 border border-danger rounded-lg p-4">
        <p className="text-danger">{getActionErrorMessage(error, t('plannedRepairs.loadAction'))}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardList aria-hidden="true" className="w-5 h-5 text-text-mute" />
          <h3 className="text-lg font-semibold text-text">{t('plannedRepairs.title')}</h3>
        </div>
        <Button variant="primary" icon={Plus} onClick={openCreate}>
          {t('plannedRepairs.add')}
        </Button>
      </div>

      {repairs.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={t('plannedRepairs.empty')}
          description={t('plannedRepairs.emptyDesc')}
          action={
            <Button variant="primary" icon={Plus} onClick={openCreate}>
              {t('plannedRepairs.addFirst')}
            </Button>
          }
        />
      ) : (
        <>
          <p className="text-xs text-text-mute">{t('plannedRepairs.boardHint')}</p>
          <PlannedRepairBoard repairs={repairs} onEdit={openEdit} onDelete={handleDelete} onMove={handleMove} />
        </>
      )}

      {showForm && (
        <PlannedRepairForm vin={vin} repair={editing} onClose={closeForm} onSuccess={() => undefined} />
      )}

      {completing && (
        <CompleteRepairDialog
          vin={vin}
          repair={completing}
          currentMileage={currentMileage}
          currentHours={currentHours}
          tracksDistance={tracksDistance}
          tracksHours={tracksHours}
          onClose={() => setCompleting(undefined)}
          onSuccess={() => setCompleting(undefined)}
        />
      )}
    </div>
  )
}
