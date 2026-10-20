import { useTranslation } from 'react-i18next'
import { formatDateForDisplay } from '../utils/dateUtils'
import { Gauge, Plus, Edit, Trash2, Radio } from 'lucide-react'
import { toast } from 'sonner'
import type { OdometerRecord } from '../types/odometer'
import { useUnitFormat } from '../hooks/useUnitFormat'
import { useOdometerRecords, useDeleteOdometerRecord } from '../hooks/queries/useOdometerRecords'
import { getActionErrorMessage } from '../utils/httpErrorHandler'
import { Button, IconButton, Card, Mono, Badge, DataTable, EmptyState } from './ui'
import type { DataTableColumn } from './ui'

interface OdometerRecordListProps {
  vin: string
  onAddClick: () => void
  onEditClick: (record: OdometerRecord) => void
  onRefresh?: () => void
}

export default function OdometerRecordList({ vin, onAddClick, onEditClick }: OdometerRecordListProps) {
  const { t } = useTranslation('vehicles')
  const u = useUnitFormat()

  const { data, isLoading, error } = useOdometerRecords(vin)
  const deleteMutation = useDeleteOdometerRecord(vin)

  const records = data?.records ?? []
  const latestOdometerKm = data?.latest_odometer_km != null
    ? (typeof data.latest_odometer_km === 'string' ? parseFloat(data.latest_odometer_km) : data.latest_odometer_km)
    : null

  const handleDelete = (recordId: number) => {
    if (!confirm(t('odometerList.confirmDelete'))) {
      return
    }

    deleteMutation.mutate(recordId, {
      onError: (err) => {
        toast.error(getActionErrorMessage(err, t('odometerList.deleteAction')))
      },
    })
  }

  const formatDate = (dateString: string) => {
    return formatDateForDisplay(dateString)
  }

  const columns: DataTableColumn<OdometerRecord>[] = [
    { id: 'date', header: t('odometerList.date'), mono: true, render: (r) => formatDate(r.date) },
    {
      id: 'mileage',
      header: t('odometerRecordList.mileageColumn', { unit: u.distance.label }),
      align: 'right',
      render: (r) => (
        <span className="inline-flex items-center justify-end gap-2">
          <Mono>{u.distance.format(parseFloat(String(r.odometer_km)))}</Mono>
          {(r as Record<string, unknown>).source === 'livelink' && (
            <Badge tone="info" icon={Radio}>
              <span className="sr-only">{t('odometerRecordList.autoTrackedByLiveLink')}</span>
            </Badge>
          )}
        </span>
      ),
    },
    { id: 'notes', header: t('odometerList.notes'), render: (r) => (r.notes ? r.notes : <span className="text-text-mute">-</span>) },
    {
      id: 'actions',
      header: t('odometerList.actions'),
      align: 'right',
      render: (r) => (
        <div className="flex justify-end gap-2">
          <IconButton icon={Edit} label={t('common:edit')} variant="ghost" size="sm" onClick={() => onEditClick(r)} />
          <IconButton
            icon={Trash2}
            label={t('common:delete')}
            variant="danger"
            size="sm"
            disabled={deleteMutation.isPending && deleteMutation.variables === r.id}
            onClick={() => handleDelete(r.id)}
          />
        </div>
      ),
    },
  ]

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[200px]">
        <div className="text-text-mute">{t('odometerList.loading')}</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-danger/10 border border-danger rounded-lg p-4">
        <p className="text-danger">{getActionErrorMessage(error, t('odometerList.loadAction'))}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Gauge aria-hidden="true" className="w-5 h-5 text-text-mute" />
          <h3 className="text-lg font-semibold text-text">{t('odometerList.title')}</h3>
          <span className="text-sm text-text-mute">({t('odometerList.recordCount', { count: records.length })})</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" icon={Plus} onClick={onAddClick}>{t('odometerList.addReading')}</Button>
        </div>
      </div>

      {latestOdometerKm !== null && (
        <Card padding="sm">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-(--accent-soft) p-3">
              <Gauge aria-hidden="true" className="w-6 h-6 text-(--accent-fg)" />
            </div>
            <div>
              <p className="text-sm text-text-mute">{t('odometerList.latestMileage')}</p>
              <Mono size="2xl" weight="bold">{u.distance.format(latestOdometerKm)}</Mono>
            </div>
          </div>
        </Card>
      )}

      {records.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title={t('odometerList.noRecords')}
          description={t('odometerList.noRecordsDesc')}
          action={<Button variant="primary" icon={Plus} onClick={onAddClick}>{t('odometerList.addFirstReading')}</Button>}
        />
      ) : (
        <Card padding="none">
          <DataTable caption={t('odometerList.tableCaption')} columns={columns} rows={records} rowKey={(r) => String(r.id)} />
        </Card>
      )}
    </div>
  )
}
