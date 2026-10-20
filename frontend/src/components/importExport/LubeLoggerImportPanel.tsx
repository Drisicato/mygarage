/**
 * Import LubeLogger CSV exports (Fuel, Service / Repair / Upgrade, Supplies)
 * into a vehicle. Several files go in at once; each one's type is read from
 * its columns, except that a service-like file can be Service, Repair or
 * Upgrade (they share one header), which the user picks.
 *
 * LubeLogger's files carry no units and follow its server's locale, so the
 * reading options are the user's to declare, and a supply's quantity has no
 * unit at all, so the preview lists each supply with a unit to pick. Preview
 * runs the import on the server and throws it away; Import saves a backup of
 * the vehicle and writes. Changing a file, an option or a record type makes
 * the preview stale; a supply's unit doesn't (it changes only how its rows
 * are stored, not what they are).
 */

import { useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, FileUp } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Field, Mono, Select } from '../ui'
import api from '../../services/api'
import { useUnitFormat } from '../../hooks/useUnitFormat'
import { useCurrencyPreference } from '../../hooks/useCurrencyPreference'
import { useDateLocale } from '../../hooks/useDateLocale'
import { formatDateForDisplay } from '../../utils/dateUtils'
import { getActionErrorMessage } from '../../utils/httpErrorHandler'
import { SUPPLY_VOLUME_UNITS, VOLUME_UNIT_LABELS, type SupplyUnit } from '../../utils/supplyUnits'
import ImportResultCard from './ImportResultCard'

type FileType = 'fuel' | 'service' | 'repair' | 'upgrade' | 'supply'

interface Options {
  distance_unit: 'mi' | 'km'
  fuel_unit: 'gal_us' | 'gal_uk' | 'l'
  date_order: 'mdy' | 'dmy' | 'ymd'
  decimal_separator: 'dot' | 'comma'
}

/** One supply a Supplies file holds: its purchases, and the MyGarage supply it joins. */
interface FileSupply {
  key: string
  name: string
  part_number: string | null
  row_count: number
  quantity: number
  existing_supply_id: number | null
  existing_supply_name: string | null
  existing_unit_type: 'volume' | 'count' | null
  unit: SupplyUnit
}

interface FileResult {
  filename: string
  record_type: FileType
  success_count: number
  skipped_count: number
  error_count: number
  errors: string[]
  row_count: number
  electric: boolean
  ignored_count: number
  date_from: string | null
  date_to: string | null
  sample: Array<Record<string, string | number | boolean | null>>
  supplies: FileSupply[]
}

interface LubeLoggerResponse {
  dry_run: boolean
  success_count: number
  skipped_count: number
  error_count: number
  files: FileResult[]
  supplies_created: number
  backup_filename: string | null
}

const DEFAULT_OPTIONS: Options = {
  distance_unit: 'mi',
  fuel_unit: 'gal_us',
  date_order: 'mdy',
  decimal_separator: 'dot',
}

/** Errors shown per file; the rest are counted. */
const SHOWN_ERRORS = 5

const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } }

interface LubeLoggerImportPanelProps {
  vin: string
}

export default function LubeLoggerImportPanel({ vin }: LubeLoggerImportPanelProps) {
  const { t } = useTranslation('vehicles')
  const queryClient = useQueryClient()
  const u = useUnitFormat()
  const { formatCurrency } = useCurrencyPreference()
  const dateLocale = useDateLocale()

  const [files, setFiles] = useState<File[]>([])
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS)
  const [preview, setPreview] = useState<LubeLoggerResponse | null>(null)
  // The service-like type picked per file; fuel and supplies files stay what they are.
  const [kinds, setKinds] = useState<FileType[]>([])
  // What each supply's quantity counts, by the preview's supply key.
  const [supplyUnits, setSupplyUnits] = useState<Record<string, SupplyUnit>>({})
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<LubeLoggerResponse | null>(null)

  const formData = (dryRun: boolean): FormData => {
    const body = new FormData()
    files.forEach((file, index) => {
      body.append('file', file)
      body.append('record_type', kinds[index] ?? 'auto')
    })
    for (const [key, value] of Object.entries(options)) body.append(key, value)
    body.append('supply_units', JSON.stringify(supplyUnits))
    body.append('skip_duplicates', 'true')
    body.append('dry_run', dryRun ? 'true' : 'false')
    return body
  }

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    setFiles(Array.from(event.target.files ?? []))
    setPreview(null)
    setKinds([])
    setSupplyUnits({})
    setStale(false)
    setResult(null)
    setError(null)
  }

  const setOption = <K extends keyof Options>(key: K, value: Options[K]) => {
    setOptions((current) => ({ ...current, [key]: value }))
    if (preview) setStale(true)
  }

  const setKind = (index: number, kind: FileType) => {
    setKinds((current) => current.map((k, i) => (i === index ? kind : k)))
    if (preview) setStale(true)
  }

  const runPreview = async () => {
    setBusy('preview')
    setError(null)
    setResult(null)
    try {
      const { data } = await api.post<LubeLoggerResponse>(`/import/vehicles/${vin}/lubelogger`, formData(true), MULTIPART)
      setPreview(data)
      setKinds((current) => data.files.map((f, i) => current[i] ?? f.record_type))
      // A unit already picked survives a fresh preview; a new supply starts at the server's guess.
      setSupplyUnits((current) =>
        Object.fromEntries(data.files.flatMap((f) => f.supplies.map((s) => [s.key, current[s.key] ?? s.unit]))),
      )
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
      const { data } = await api.post<LubeLoggerResponse>(`/import/vehicles/${vin}/lubelogger`, formData(false), MULTIPART)
      setResult(data)
      setPreview(null)
      void queryClient.invalidateQueries()
      toast.success(t('lubelogger.done', { count: data.success_count }))
    } catch (err) {
      setError(getActionErrorMessage(err, t('lubelogger.importAction')))
    } finally {
      setBusy(null)
    }
  }

  const formatDate = (iso: string | null) => (iso ? formatDateForDisplay(iso, undefined, dateLocale) : '')

  const typeOptions = (file: FileResult) =>
    file.record_type === 'fuel' || file.record_type === 'supply'
      ? [{ value: file.record_type, label: t(`lubelogger.type.${file.record_type}`) }]
      : (['service', 'repair', 'upgrade'] as const).map((k) => ({ value: k, label: t(`lubelogger.type.${k}`) }))

  // A count supply already in MyGarage stays a count; a volume one can only take another volume unit.
  const unitOptions = (supply: FileSupply) => {
    const volume = SUPPLY_VOLUME_UNITS.map((unit) => ({ value: unit, label: t(VOLUME_UNIT_LABELS[unit].labelKey) }))
    const count = { value: 'count', label: t('lubelogger.supplyCount') }
    if (supply.existing_unit_type === 'count') return [count]
    if (supply.existing_unit_type === 'volume') return volume
    return [count, ...volume]
  }

  const shown = result ?? preview
  const summaryLine = (r: { success_count: number; skipped_count: number; error_count: number }) =>
    t(result ? 'lubelogger.summary' : 'lubelogger.previewSummary', {
      imported: r.success_count,
      skipped: r.skipped_count,
      failed: r.error_count,
    })

  return (
    <div className="space-y-5">
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
            onChange={(e) => setOption('decimal_separator', e.target.value as Options['decimal_separator'])}
            options={[
              { value: 'dot', label: t('lubelogger.decimalDot') },
              { value: 'comma', label: t('lubelogger.decimalComma') },
            ]}
          />
        </Field>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger bg-danger/10 border border-danger rounded-lg p-3">
          {error}
        </p>
      )}
      {stale && <p className="text-xs text-warning">{t('lubelogger.stale')}</p>}

      {shown && !stale && (
        <div className="space-y-3">
          <p className="text-sm text-text">{summaryLine(shown)}</p>
          {result && result.supplies_created > 0 && (
            <p className="text-sm text-text-mute">{t('lubelogger.suppliesCreated', { count: result.supplies_created })}</p>
          )}
          {shown.files.map((file, index) => (
            <Card key={`${file.filename}-${index}`} padding="sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-text truncate">{file.filename}</span>
                {result ? (
                  <Badge tone="muted">{t(`lubelogger.type.${file.record_type}`)}</Badge>
                ) : (
                  <div className="w-44">
                    <Select
                      aria-label={t('lubelogger.recordType', { file: file.filename })}
                      value={kinds[index] ?? file.record_type}
                      onChange={(e) => setKind(index, e.target.value as FileType)}
                      options={typeOptions(file)}
                      disabled={file.record_type === 'fuel' || file.record_type === 'supply'}
                      size="sm"
                    />
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs text-text-mute">
                {summaryLine(file)}
                {file.date_from &&
                  ` · ${t('lubelogger.dateRange', { from: formatDate(file.date_from), to: formatDate(file.date_to) })}`}
                {file.electric && ` · ${t('lubelogger.electric')}`}
                {file.ignored_count > 0 &&
                  ` · ${t(file.record_type === 'supply' ? 'lubelogger.usedUp' : 'lubelogger.ignored', { count: file.ignored_count })}`}
              </p>

              {!result && file.supplies.length > 0 && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-text-mute">{t('lubelogger.supplyUnitHint')}</p>
                  {file.supplies.map((supply) => (
                    <div key={supply.key} className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-text truncate">
                          {supply.name}
                          {supply.part_number && <Mono size="xs" tone="muted">{` ${supply.part_number}`}</Mono>}
                        </p>
                        <p className="text-xs text-text-mute">
                          {t('lubelogger.supplyPurchases', { count: supply.row_count, quantity: supply.quantity })}
                          {' · '}
                          {supply.existing_supply_name
                            ? t('lubelogger.supplyJoins', { name: supply.existing_supply_name })
                            : t('lubelogger.supplyNew')}
                        </p>
                      </div>
                      <div className="w-48">
                        <Select
                          aria-label={t('lubelogger.supplyUnit', { name: supply.name })}
                          value={supplyUnits[supply.key] ?? supply.unit}
                          onChange={(e) =>
                            setSupplyUnits((current) => ({ ...current, [supply.key]: e.target.value as SupplyUnit }))
                          }
                          options={unitOptions(supply)}
                          disabled={supply.existing_unit_type === 'count'}
                          size="sm"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!result && file.record_type !== 'supply' && file.sample.length > 0 && (
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

              {file.errors.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {file.errors.slice(0, SHOWN_ERRORS).map((e) => (
                    <p key={e} className="text-xs text-danger">{e}</p>
                  ))}
                </div>
              )}
            </Card>
          ))}
          {result ? (
            <ImportResultCard
              vin={vin}
              preview={false}
              summary={{
                success_count: result.success_count,
                skipped_count: result.skipped_count,
                error_count: result.error_count,
                errors: [],
                backupFilename: result.backup_filename,
              }}
            />
          ) : (
            <p className="text-xs text-text-mute">{t('lubelogger.backupNote')}</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
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
          disabled={!preview || stale || preview.success_count === 0 || busy !== null}
        >
          {t('lubelogger.import', { count: preview?.success_count ?? 0 })}
        </Button>
      </div>
    </div>
  )
}
