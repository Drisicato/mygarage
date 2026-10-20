/**
 * Import one file into a vehicle: MyGarage CSV or JSON, or another app's fuel
 * export. Preview runs the whole import on the server and throws it away, so
 * it reports exactly what Import would; Import then saves a backup of the
 * vehicle and writes. Changing the file or an option makes the preview stale.
 */

import { useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, FileUp } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, Select } from '../ui'
import api from '../../services/api'
import { getActionErrorMessage } from '../../utils/httpErrorHandler'
import { useUnitPreference } from '../../hooks/useUnitPreference'
import { buildImportSummary } from '../../utils/importSummary'
import ImportResultCard from './ImportResultCard'
import {
  NEEDS_READ_OPTIONS,
  acceptFor,
  importPath,
  summarize,
  type ImportFormat,
  type ImportResponse,
  type ImportSummary,
  type RecordKind,
} from './importCatalog'

/** The api client defaults to JSON, which would send FormData empty. */
const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } }

interface ImportPanelProps {
  vin: string
  kind: RecordKind
  format: ImportFormat
}

export default function ImportPanel({ vin, kind, format }: ImportPanelProps) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const { units } = useUnitPreference()
  const [file, setFile] = useState<File | null>(null)
  const [odometerUnit, setOdometerUnit] = useState<'km' | 'mi'>(units.distance === 'mi' ? 'mi' : 'km')
  const [decimalSeparator, setDecimalSeparator] = useState<'dot' | 'comma'>('dot')
  const [preview, setPreview] = useState<ImportSummary | null>(null)
  const [stale, setStale] = useState(false)
  const [result, setResult] = useState<ImportSummary | null>(null)
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const readOptions = NEEDS_READ_OPTIONS.has(format)

  const changed = () => {
    if (preview) setStale(true)
    setResult(null)
  }

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null)
    setPreview(null)
    setStale(false)
    setResult(null)
    setError(null)
  }

  const send = async (dryRun: boolean): Promise<ImportSummary | null> => {
    if (!file) return null
    const body = new FormData()
    body.append('file', file)
    body.append('skip_duplicates', 'true')
    body.append('dry_run', dryRun ? 'true' : 'false')
    if (readOptions) {
      body.append('odometer_unit', odometerUnit)
      body.append('decimal_separator', decimalSeparator)
    }
    const { data } = await api.post<ImportResponse>(importPath(vin, kind, format), body, MULTIPART)
    const summary = summarize(data)
    // The whole-vehicle import writes several record types: say how each went.
    return format === 'json' ? { ...summary, details: buildImportSummary(data as Parameters<typeof buildImportSummary>[0], t) } : summary
  }

  const runPreview = async () => {
    setBusy('preview')
    setError(null)
    try {
      setPreview(await send(true))
      setStale(false)
    } catch (err) {
      setPreview(null)
      setError(getActionErrorMessage(err, t('importExport.previewAction')))
    } finally {
      setBusy(null)
    }
  }

  const runImport = async () => {
    setBusy('import')
    setError(null)
    try {
      const summary = await send(false)
      setResult(summary)
      setPreview(null)
      void queryClient.invalidateQueries()
      if (summary) toast.success(t('importExport.done', { count: summary.success_count }))
    } catch (err) {
      setError(getActionErrorMessage(err, t('importExport.importAction')))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <Field id="import-file" label={t('importExport.file')} hint={t(`importExport.fileHint.${format}`)}>
        <input
          id="import-file"
          type="file"
          accept={acceptFor(format)}
          onChange={handleFile}
          disabled={busy !== null}
          className="block w-full text-sm text-text file:mr-3 file:rounded-control file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-text"
        />
      </Field>

      {readOptions && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field id="import-odometer-unit" label={t('importExport.odometerUnit')}>
            <Select
              id="import-odometer-unit"
              value={odometerUnit}
              onChange={(e) => {
                setOdometerUnit(e.target.value as 'km' | 'mi')
                changed()
              }}
              options={[
                { value: 'mi', label: t('importExport.miles') },
                { value: 'km', label: t('importExport.kilometers') },
              ]}
            />
          </Field>
          <Field id="import-decimal" label={t('importExport.numberFormat')}>
            <Select
              id="import-decimal"
              value={decimalSeparator}
              onChange={(e) => {
                setDecimalSeparator(e.target.value as 'dot' | 'comma')
                changed()
              }}
              options={[
                { value: 'dot', label: '1,234.56' },
                { value: 'comma', label: '1.234,56' },
              ]}
            />
          </Field>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger bg-danger/10 border border-danger rounded-lg p-3">
          {error}
        </p>
      )}
      {stale && <p className="text-xs text-warning">{t('importExport.stale')}</p>}
      {preview && !stale && <ImportResultCard vin={vin} summary={preview} preview />}
      {result && <ImportResultCard vin={vin} summary={result} preview={false} />}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          icon={Eye}
          onClick={() => void runPreview()}
          loading={busy === 'preview'}
          disabled={!file || busy !== null}
        >
          {t('importExport.preview')}
        </Button>
        <Button
          icon={FileUp}
          onClick={() => void runImport()}
          loading={busy === 'import'}
          disabled={!preview || stale || preview.success_count === 0 || busy !== null}
        >
          {t('importExport.import', { count: preview?.success_count ?? 0 })}
        </Button>
      </div>
    </div>
  )
}
