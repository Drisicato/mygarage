/**
 * What can be imported and exported for a vehicle, in which formats, and the
 * API route each one uses. Settings > Import & Export is built from this.
 */

export const RECORD_KINDS = [
  'fuel',
  'service',
  'supplies',
  'odometer',
  'def',
  'hours',
  'warranties',
  'insurance',
  'tax',
  'notes',
  'vehicle',
] as const
export type RecordKind = (typeof RECORD_KINDS)[number]

export type ImportFormat = 'mygarage' | 'fuelio' | 'drivvo' | 'tesla' | 'external' | 'lubelogger' | 'json'

/** The formats each record type imports from, MyGarage's own first. */
export const IMPORT_FORMATS: Readonly<Record<RecordKind, readonly ImportFormat[]>> = {
  fuel: ['mygarage', 'fuelio', 'drivvo', 'tesla', 'external', 'lubelogger'],
  service: ['mygarage', 'lubelogger'],
  supplies: ['mygarage', 'lubelogger'],
  odometer: ['mygarage'],
  def: ['mygarage'],
  hours: ['mygarage'],
  warranties: ['mygarage'],
  insurance: ['mygarage'],
  tax: ['mygarage'],
  notes: ['mygarage'],
  vehicle: ['json'],
}

/** Other apps' fuel exports don't say what units or decimal style they use, so the user does. */
export const NEEDS_READ_OPTIONS: ReadonlySet<ImportFormat> = new Set(['fuelio', 'drivvo', 'tesla', 'external'])

/** The `/import/vehicles/{vin}/…` path for a record type in a format. */
export function importPath(vin: string, kind: RecordKind, format: ImportFormat): string {
  const base = `/import/vehicles/${vin}`
  switch (format) {
    case 'json':
      return `${base}/json`
    case 'lubelogger':
      return `${base}/lubelogger`
    case 'mygarage':
      return `${base}/${kind}/csv`
    default:
      // Fuelio, Drivvo, Tesla and the auto-detecting "other app" are fuel-only.
      return `${base}/fuel/${format}`
  }
}

/** The `/export/vehicles/{vin}/…` path for a record type: MyGarage CSV, or JSON for the whole vehicle. */
export function exportPath(vin: string, kind: RecordKind): string {
  return kind === 'vehicle' ? `/export/vehicles/${vin}/json` : `/export/vehicles/${vin}/${kind}/csv`
}

export function acceptFor(format: ImportFormat): string {
  return format === 'json' ? '.json,application/json' : '.csv,text/csv'
}

/** One section's counts, as every import reports them. */
export interface ImportCounts {
  success_count: number
  skipped_count: number
  error_count: number
}

/** An import's answer, preview or real, in either of the two shapes the routes return. */
export interface ImportResponse extends Partial<ImportCounts> {
  dry_run?: boolean
  backup_filename?: string | null
  errors?: string[]
  [section: string]: unknown
}

export interface ImportSummary extends ImportCounts {
  errors: string[]
  backupFilename: string | null
  /** Per-section lines, for the whole-vehicle import (several record types at once). */
  details?: string
}

function isCounts(value: unknown): value is ImportCounts {
  return typeof value === 'object' && value !== null && 'success_count' in value
}

/**
 * One set of counts for any import: the CSV routes report them at the top
 * level; the whole-vehicle JSON import reports them per section.
 */
export function summarize(data: ImportResponse): ImportSummary {
  const errors = Array.isArray(data.errors) ? data.errors.map(String) : []
  const backupFilename = data.backup_filename ?? null
  if (isCounts(data)) {
    return {
      success_count: data.success_count,
      skipped_count: data.skipped_count,
      error_count: data.error_count,
      errors,
      backupFilename,
    }
  }
  const sections = Object.values(data).filter(isCounts)
  const total = (key: keyof ImportCounts) => sections.reduce((sum, s) => sum + Number(s[key] ?? 0), 0)
  return {
    success_count: total('success_count'),
    skipped_count: total('skipped_count'),
    error_count: total('error_count'),
    errors,
    backupFilename,
  }
}
