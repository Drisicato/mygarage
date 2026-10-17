import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardCheck, Plus } from 'lucide-react'
import { toast } from 'sonner'
import InspectionCard, { cornerRowKey } from '../inspections/InspectionCard'
import InspectionForm from '../inspections/InspectionForm'
import { Button, EmptyState } from '../ui'
import {
  useCreateRepairFromInspectionCorner,
  useCreateRepairFromInspectionItem,
  useDeleteVehicleInspection,
  useVehicleInspections,
} from '../../hooks/queries/useVehicleInspections'
import { getActionErrorMessage } from '../../utils/httpErrorHandler'
import { formatDateForDisplay } from '../../utils/dateUtils'
import { itemLabelKey } from '../../utils/inspectionChecklist'
import { useDateLocale } from '../../hooks/useDateLocale'
import type {
  InspectionCornerPosition,
  InspectionCornerReading,
  InspectionItemKey,
  VehicleInspection,
  VehicleInspectionItem,
} from '../../types/vehicleInspection'

interface InspectionsTabProps {
  vin: string
}

export default function InspectionsTab({ vin }: InspectionsTabProps) {
  const { t } = useTranslation('vehicles')
  const dateLocale = useDateLocale()
  const { data, isLoading, error } = useVehicleInspections(vin)
  const deleteMutation = useDeleteVehicleInspection(vin)
  const createRepairMutation = useCreateRepairFromInspectionItem(vin)
  const createCornerRepairMutation = useCreateRepairFromInspectionCorner(vin)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<VehicleInspection | undefined>()
  const [creatingItemKey, setCreatingItemKey] = useState<string | null>(null)

  // The API already sends newest first.
  const inspections = data?.inspections ?? []

  const openCreate = () => {
    setEditing(undefined)
    setShowForm(true)
  }

  const openEdit = (inspection: VehicleInspection) => {
    setEditing(inspection)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditing(undefined)
  }

  const handleDelete = (inspection: VehicleInspection) => {
    const date = formatDateForDisplay(inspection.date, undefined, dateLocale)
    if (!confirm(t('vehicleInspections.confirmDelete', { date }))) return
    deleteMutation.mutate(inspection.id, {
      onError: (err) => toast.error(getActionErrorMessage(err, t('vehicleInspections.deleteAction'))),
    })
  }

  const handleCreateRepair = (inspection: VehicleInspection, item: VehicleInspectionItem) => {
    setCreatingItemKey(item.item_key)
    createRepairMutation.mutate(
      {
        inspectionId: inspection.id,
        // Stored keys came in through the same fixed list, so a stored one is always a known key.
        itemKey: item.item_key as InspectionItemKey,
        title: t(itemLabelKey(item.item_key)),
      },
      {
        onSuccess: () => toast.success(t('vehicleInspections.repairCreatedToast')),
        onError: (err) => toast.error(getActionErrorMessage(err, t('vehicleInspections.createRepairAction'))),
        onSettled: () => setCreatingItemKey(null),
      },
    )
  }

  const handleCreateCornerRepair = (
    inspection: VehicleInspection,
    position: InspectionCornerPosition,
    reading: InspectionCornerReading,
    title: string,
  ) => {
    setCreatingItemKey(cornerRowKey(position, reading))
    createCornerRepairMutation.mutate(
      { inspectionId: inspection.id, position, reading, title },
      {
        onSuccess: () => toast.success(t('vehicleInspections.repairCreatedToast')),
        onError: (err) => toast.error(getActionErrorMessage(err, t('vehicleInspections.createRepairAction'))),
        onSettled: () => setCreatingItemKey(null),
      },
    )
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[200px]">
        <div className="text-text-mute">{t('vehicleInspections.loading')}</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-danger/10 border border-danger rounded-lg p-4">
        <p className="text-danger">{getActionErrorMessage(error, t('vehicleInspections.loadAction'))}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardCheck aria-hidden="true" className="w-5 h-5 text-text-mute" />
          <h3 className="text-lg font-semibold text-text">{t('vehicleInspections.title')}</h3>
        </div>
        <Button variant="primary" icon={Plus} onClick={openCreate}>
          {t('vehicleInspections.add')}
        </Button>
      </div>

      {inspections.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={t('vehicleInspections.empty')}
          description={t('vehicleInspections.emptyDesc')}
          action={
            <Button variant="primary" icon={Plus} onClick={openCreate}>
              {t('vehicleInspections.addFirst')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {inspections.map((inspection) => (
            <InspectionCard
              key={inspection.id}
              inspection={inspection}
              onEdit={openEdit}
              onDelete={handleDelete}
              onCreateRepair={handleCreateRepair}
              onCreateCornerRepair={handleCreateCornerRepair}
              creatingItemKey={creatingItemKey}
            />
          ))}
        </div>
      )}

      {showForm && (
        <InspectionForm vin={vin} inspection={editing} onClose={closeForm} onSuccess={() => undefined} />
      )}
    </div>
  )
}
