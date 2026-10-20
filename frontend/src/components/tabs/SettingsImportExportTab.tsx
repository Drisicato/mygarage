/**
 * Settings > Import & Export: the one place a vehicle's records come in or go
 * out. Pick the vehicle, Import or Export, what kind of records, and (to
 * import) the file's format; every import previews first and backs the
 * vehicle up before it writes.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownToLine, ArrowUpFromLine, Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, CardHeader, Field, Select, Tabs } from '../ui'
import { useQuickEntryVehicles } from '../../hooks/queries/useQuickEntryVehicles'
import { vehicleLabel } from '../../utils/vehicleLabel'
import { getActionErrorMessage } from '../../utils/httpErrorHandler'
import ImportPanel from '../importExport/ImportPanel'
import LubeLoggerImportPanel from '../importExport/LubeLoggerImportPanel'
import { downloadFile } from '../importExport/download'
import {
  IMPORT_FORMATS,
  RECORD_KINDS,
  exportPath,
  type ImportFormat,
  type RecordKind,
} from '../importExport/importCatalog'

type Mode = 'import' | 'export'

export default function SettingsImportExportTab() {
  const { t } = useTranslation('settings')
  const { data: vehicles = [], isLoading } = useQuickEntryVehicles()
  const [pickedVin, setPickedVin] = useState<string>('')
  const [mode, setMode] = useState<Mode>('import')
  const [kind, setKind] = useState<RecordKind>('fuel')
  const [format, setFormat] = useState<ImportFormat>('mygarage')
  const [exporting, setExporting] = useState(false)

  // The first vehicle until one is picked (or if the picked one is gone).
  const vin = vehicles.some((v) => v.vin === pickedVin) ? pickedVin : (vehicles[0]?.vin ?? '')
  const formats = IMPORT_FORMATS[kind]

  const pickKind = (next: RecordKind) => {
    setKind(next)
    // Keep the format if the new type has it too (LubeLogger, for one), else its first.
    if (!IMPORT_FORMATS[next].includes(format)) setFormat(IMPORT_FORMATS[next][0])
  }

  const runExport = async () => {
    setExporting(true)
    try {
      await downloadFile(exportPath(vin, kind), `${vin}_${kind}.${kind === 'vehicle' ? 'json' : 'csv'}`)
    } catch (err) {
      toast.error(getActionErrorMessage(err, t('importExport.exportAction')))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t('importExport.title')} icon={ArrowDownToLine} />
        <p className="mb-4 text-sm text-text-mute">{t('importExport.intro')}</p>

        {!isLoading && vehicles.length === 0 ? (
          <p className="text-sm text-text-mute">{t('importExport.noVehicles')}</p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field id="import-export-vehicle" label={t('importExport.vehicle')}>
                <Select
                  id="import-export-vehicle"
                  value={vin}
                  onChange={(e) => setPickedVin(e.target.value)}
                  options={vehicles.map((v) => ({ value: v.vin, label: vehicleLabel(v) }))}
                  disabled={isLoading}
                />
              </Field>
              <div className="flex items-end">
                <Tabs
                  variant="segmented"
                  label={t('importExport.mode')}
                  activeId={mode}
                  onChange={(id) => setMode(id as Mode)}
                  items={[
                    { id: 'import', label: t('importExport.importTab'), icon: ArrowDownToLine },
                    { id: 'export', label: t('importExport.exportTab'), icon: ArrowUpFromLine },
                  ]}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field id="import-export-kind" label={t('importExport.recordType')}>
                <Select
                  id="import-export-kind"
                  value={kind}
                  onChange={(e) => pickKind(e.target.value as RecordKind)}
                  options={RECORD_KINDS.map((k) => ({ value: k, label: t(`importExport.kinds.${k}`) }))}
                />
              </Field>
              {mode === 'import' && (
                <Field id="import-export-format" label={t('importExport.format')}>
                  <Select
                    id="import-export-format"
                    value={format}
                    onChange={(e) => setFormat(e.target.value as ImportFormat)}
                    options={formats.map((f) => ({ value: f, label: t(`importExport.formats.${f}`) }))}
                    disabled={formats.length === 1}
                  />
                </Field>
              )}
            </div>

            {vin && mode === 'import' && (
              // Keyed so a new vehicle, type or format starts from an empty form.
              <div key={`${vin}-${kind}-${format}`} className="border-t border-border pt-5">
                {format === 'lubelogger' ? (
                  <LubeLoggerImportPanel vin={vin} />
                ) : (
                  <ImportPanel vin={vin} kind={kind} format={format} />
                )}
              </div>
            )}

            {vin && mode === 'export' && (
              <div className="border-t border-border pt-5 space-y-3">
                <p className="text-sm text-text-mute">
                  {t(kind === 'vehicle' ? 'importExport.exportJsonHint' : 'importExport.exportCsvHint')}
                </p>
                <Button icon={Download} onClick={() => void runExport()} loading={exporting}>
                  {t('importExport.download', { kind: t(`importExport.kinds.${kind}`) })}
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
