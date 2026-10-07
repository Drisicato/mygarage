/**
 * Import LubeLogger CSV exports (Fuel, Service / Repair / Upgrade) into this
 * vehicle, in two steps: Preview reads the files and writes nothing; Import
 * saves a JSON backup of the vehicle, then writes every file in one go.
 *
 * LubeLogger's CSVs carry no units and follow its server's locale, so the
 * reading options are the user's to declare. Changing one after a preview
 * makes that preview stale: Import stays off until the files are read again
 * the way they will be imported.
 */

import { useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Eye, FileUp } from 'lucide-react'
import { toast } from 'sonner'
import FormModalWrapper from '../FormModalWrapper'
import { Badge, Button, Card, Field, Mono, Select } from '../ui'
import api from '../../services/api'
import { useUnitFormat } from '../../hooks/useUnitFormat'
import { useCurrencyPreference } from '../../hooks/useCurrencyPreference'
import { useDateLocale } from '../../hooks/useDateLocale'
import { formatDateForDisplay } from '../../utils/dateUtils'
import { getActionErrorMessage } from '../../utils/httpErrorHandler'

type RecordType = 'fuel' | 'service' | 'repair' | 'upgrade'

interface Options {
  distance_unit: 'mi' | 'km'
  fuel_unit: 'gal_us' | 'gal_uk' | 'l'
  date_order: 'mdy' | 'dmy' | 'ymd'
  decimal_separator: 'dot' | 'comma'
}

interface PreviewFile {
  filename: string
  record_type: RecordType
  electric: boolean
  row_count: number
  error_count: number
  ignored_count: number
  errors: string[]
  date_from: string | null
  date_to: string | null
  sample: Array<Record<string, string | number | boolean | null>>
}

interface ImportFileResult {
  filename: string
  record_type: RecordType
  success_count: number
  error_count: number
  skipped_count: number
  errors: string[]
}

interface ImportResponse {
  success_count: number
  error_count: number
  skipped_count: number
  files: ImportFileResult[]
  backup_filename: string
}

interface LubeLoggerImportModalProps {
  vin: string
  onClose: () => void
}

const DEFAULT_OPTIONS: Options = {
  distance_unit: 'mi',
  fuel_unit: 'gal_us',
  date_order: 'mdy',
  decimal_separator: 'dot',
}

/** Errors shown per file; the rest are counted. */
const SHOWN_ERRORS = 5

/** The api client defaults to JSON, which would send the FormData as `{}`
 *  and arrive with no files; every upload in the app overrides it like this. */
const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } }

export default function LubeLoggerImportModal({ vin, onClose }: LubeLoggerImportModalProps) {
  const { t } = useTranslation('vehicles')
  const queryClient = useQueryClient()
  const u = useUnitFormat()
  const { formatCurrency } = useCurrencyPreference()
  const dateLocale = useDateLocale()

  const [files, setFiles] = useState<File[]>([])
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS)
  const [preview, setPreview] = useState<PreviewFile[] | null>(null)
  // The service-like kind the user picked per file; fuel files stay fuel.
  const [kinds, setKinds] = useState<RecordType[]>([])
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResponse | null>(null)

  const formData = (dryRun: boolean): FormData => {
    const body = new FormData()
    files.forEach((file, index) => {
      body.append('file', file)
      body.append('record_type', dryRun && !preview ? 'auto' : (kinds[index] ?? 'auto'))
    })
    for (const [key, value] of Object.entries(options)) body.append(key, value)
    body.append('skip_duplicates', 'true')
    body.append('dry_run', dryRun ? 'true' : 'false')
    return body
  }

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    setFiles(Array.from(event.target.files ?? []))
    setPreview(null)
    setKinds([])
    setResult(null)
    setError(null)
  }

  const setOption = <K extends keyof Options>(key: K, value: Options[K]) => {
    setOptions((current) => ({ ...current, [key]: value }))
    if (preview) setStale(true)
  }

  const setKind = (index: number, kind: RecordType) => {
    setKinds((current) => current.map((k, i) => (i === index ? kind : k)))
    if (preview) setStale(true)
  }

  const runPreview = async () => {
    setBusy('preview')
    setError(null)
    try {
      const { data } = await api.post<{ files: PreviewFile[] }>(
        `/import/vehicles/${vin}/lubelogger`,
        formData(true),
        MULTIPART,
      )
      setPreview(data.files)
      setKinds((current) => data.files.map((f, i) => current[i] ?? f.record_type))
      setStale(false)
    } catch (err) {
      setPreview(null)
      setError(getActionErrorMessage(err, t('lubelogger.previewAction')))
    } finally {
      setBusy(null)
    }
  }

  const runImport = async () => {
    setBusy('import')
    setError(null)
    try {
      const { data } = await api.post<ImportResponse>(
        `/import/vehicles/${vin}/lubelogger`,
        formData(false),
        MULTIPART,
      )
      setResult(data)
      void queryClient.invalidateQueries()
      toast.success(t('lubelogger.done', { count: data.success_count }))
    } catch (err) {
      setError(getActionErrorMessage(err, t('lubelogger.importAction')))
    } finally {
      setBusy(null)
    }
  }

  const downloadBackup = async (filename: string) => {
    try {
      const response = await api.get(`/import/vehicles/${vin}/backups/${encodeURIComponent(filename)}`, {
        responseType: 'blob',
      })
      const url = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(getActionErrorMessage(err, t('lubelogger.backupAction')))
    }
  }

  const rowsToImport = preview?.reduce((sum, f) => sum + f.row_count, 0) ?? 0
  const formatDate = (iso: string | null) => (iso ? formatDateForDisplay(iso, undefined, dateLocale) : '')

  const typeOptions = (file: PreviewFile) =>
    file.record_type === 'fuel'
      ? [{ value: 'fuel', label: t('lubelogger.type.fuel') }]
      : (['service', 'repair', 'upgrade'] as const).map((k) => ({ value: k, label: t(`lubelogger.type.${k}`) }))

  const footer = result ? (
    <Button onClick={onClose}>{t('common:close')}</Button>
  ) : (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy !== null}>
        {t('common:cancel')}
      </Button>
      <Button
        variant="secondary"
        icon={Eye}
        onClick={() => void runPreview()}
        loading={busy === 'preview'}
        disabled={files.length === 0 || busy !== null}
      >
        {t('lubelogger.preview')}
      </Button>
      <Button
        icon={FileUp}
        onClick={() => void runImport()}
        loading={busy === 'import'}
        disabled={!preview || stale || rowsToImport === 0 || busy !== null}
      >
        {t('lubelogger.import', { count: rowsToImport })}
      </Button>
    </>
  )

  return (
    <FormModalWrapper title={t('lubelogger.title')} icon={FileUp} onClose={onClose} width="lg" footer={footer}>
      <div className="p-6 space-y-5">
        {error && (
          <p role="alert" className="text-sm text-danger bg-danger/10 border border-danger rounded-lg p-3">
            {error}
          </p>
        )}

        {result ? (
          <div className="space-y-4">
            <p className="text-sm text-text">
              {t('lubelogger.summary', {
                imported: result.success_count,
                skipped: result.skipped_count,
                failed: result.error_count,
              })}
            </p>
            {result.files.map((file) => (
              <Card key={file.filename} padding="sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-text truncate">{file.filename}</span>
                  <Badge tone="muted">{t(`lubelogger.type.${file.record_type}`)}</Badge>
                </div>
                <p className="mt-1 text-xs text-text-mute">
                  {t('lubelogger.summary', {
                    imported: file.success_count,
                    skipped: file.skipped_count,
                    failed: file.error_count,
                  })}
                </p>
                {file.errors.slice(0, SHOWN_ERRORS).map((e) => (
                  <p key={e} className="text-xs text-danger">{e}</p>
                ))}
              </Card>
            ))}
            <div className="rounded-lg border border-border bg-surface-2 p-3 space-y-2">
              <p className="text-sm text-text">{t('lubelogger.backupSaved')}</p>
              <Mono size="sm" tone="muted">{result.backup_filename}</Mono>
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Download}
                  onClick={() => void downloadBackup(result.backup_filename)}
                >
                  {t('lubelogger.downloadBackup')}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-text-mute">{t('lubelogger.intro')}</p>

            <Field id="lubelogger-files" label={t('lubelogger.files')} hint={t('lubelogger.filesHint')}>
              <input
                id="lubelogger-files"
                type="file"
                accept=".csv,text/csv"
                multiple
                onChange={handleFiles}
                disabled={busy !== null}
                className="block w-full text-sm text-text file:mr-3 file:rounded-control file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-text"
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field id="lubelogger-distance" label={t('lubelogger.distanceUnit')}>
                <Select
                  id="lubelogger-distance"
                  value={options.distance_unit}
                  onChange={(e) => setOption('distance_unit', e.target.value as Options['distance_unit'])}
                  options={[
                    { value: 'mi', label: t('lubelogger.miles') },
                    { value: 'km', label: t('lubelogger.kilometers') },
                  ]}
                />
              </Field>
              <Field id="lubelogger-fuel" label={t('lubelogger.fuelUnit')}>
                <Select
                  id="lubelogger-fuel"
                  value={options.fuel_unit}
                  onChange={(e) => setOption('fuel_unit', e.target.value as Options['fuel_unit'])}
                  options={[
                    { value: 'gal_us', label: t('lubelogger.usGallons') },
                    { value: 'gal_uk', label: t('lubelogger.ukGallons') },
                    { value: 'l', label: t('lubelogger.litres') },
                  ]}
                />
              </Field>
              <Field id="lubelogger-dates" label={t('lubelogger.dateOrder')}>
                <Select
                  id="lubelogger-dates"
                  value={options.date_order}
                  onChange={(e) => setOption('date_order', e.target.value as Options['date_order'])}
                  options={[
                    { value: 'mdy', label: t('lubelogger.mdy') },
                    { value: 'dmy', label: t('lubelogger.dmy') },
                    { value: 'ymd', label: t('lubelogger.ymd') },
                  ]}
                />
              </Field>
              <Field id="lubelogger-numbers" label={t('lubelogger.numberFormat')}>
                <Select
                  id="lubelogger-numbers"
                  value={options.decimal_separator}
                  onChange={(e) =>
                    setOption('decimal_separator', e.target.value as Options['decimal_separator'])
                  }
                  options={[
                    { value: 'dot', label: t('lubelogger.decimalDot') },
                    { value: 'comma', label: t('lubelogger.decimalComma') },
                  ]}
                />
              </Field>
            </div>

            {stale && <p className="text-xs text-warning">{t('lubelogger.stale')}</p>}

            {preview && (
              <div className="space-y-3">
                {preview.map((file, index) => (
                  <Card key={`${file.filename}-${index}`} padding="sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-text truncate">{file.filename}</span>
                      <div className="w-44">
                        <Select
                          aria-label={t('lubelogger.recordType', { file: file.filename })}
                          value={kinds[index] ?? file.record_type}
                          onChange={(e) => setKind(index, e.target.value as RecordType)}
                          options={typeOptions(file)}
                          disabled={file.record_type === 'fuel'}
                          size="sm"
                        />
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-text-mute">
                      {t('lubelogger.rowsFound', { count: file.row_count })}
                      {file.date_from &&
                        ` · ${t('lubelogger.dateRange', { from: formatDate(file.date_from), to: formatDate(file.date_to) })}`}
                      {file.electric && ` · ${t('lubelogger.electric')}`}
                      {file.ignored_count > 0 && ` · ${t('lubelogger.ignored', { count: file.ignored_count })}`}
                    </p>
                    {file.sample.length > 0 && (
                      <ul className="mt-2 space-y-0.5">
                        {file.sample.map((row, i) => (
                          <li key={i} className="text-xs text-text-dim truncate">
                            <Mono size="xs" tone="muted">{formatDate(String(row.date))}</Mono>
                            {row.odometer_km != null && ` · ${u.distance.format(Number(row.odometer_km))}`}
                            {row.description != null && ` · ${String(row.description)}`}
                            {row.cost != null && ` · ${formatCurrency(Number(row.cost))}`}
                          </li>
                        ))}
                      </ul>
                    )}
                    {file.error_count > 0 && (
                      <div className="mt-2 space-y-0.5">
                        <p className="text-xs text-warning">
                          {t('lubelogger.unreadable', { count: file.error_count })}
                        </p>
                        {file.errors.slice(0, SHOWN_ERRORS).map((e) => (
                          <p key={e} className="text-xs text-text-mute">{e}</p>
                        ))}
                      </div>
                    )}
                  </Card>
                ))}
                <p className="text-xs text-text-mute">{t('lubelogger.backupNote')}</p>
              </div>
            )}
          </>
        )}
      </div>
    </FormModalWrapper>
  )
}
