import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '../../../__tests__/test-utils'

const post = vi.fn()
const get = vi.fn()
vi.mock('@/services/api', () => ({
  default: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/hooks/useUnitFormat', () => ({
  useUnitFormat: () => ({ distance: { format: (km: number) => `${km} km` } }),
}))
vi.mock('@/hooks/useCurrencyPreference', () => ({
  useCurrencyPreference: () => ({ formatCurrency: (v: number) => `$${v}`, currencyCode: 'USD' }),
}))
vi.mock('@/hooks/useDateLocale', () => ({ useDateLocale: () => 'en-US' }))

import LubeLoggerImportPanel from '../LubeLoggerImportPanel'

const VIN = 'VIN00000000000001'

const file = (over: Record<string, unknown>) => ({
  filename: 'x.csv', record_type: 'fuel', success_count: 0, skipped_count: 0, error_count: 0, errors: [],
  row_count: 0, electric: false, ignored_count: 0, date_from: null, date_to: null, sample: [], supplies: [],
  ...over,
})

const PREVIEW = {
  dry_run: true, success_count: 3, skipped_count: 0, error_count: 1, supplies_created: 0, backup_filename: null,
  files: [
    file({ filename: 'fuel.csv', success_count: 2, row_count: 2, date_from: '2026-10-06', date_to: '2026-10-20' }),
    file({
      filename: 'repairs.csv', record_type: 'service', success_count: 1, error_count: 1, row_count: 1,
      errors: ['Row 3: impossible date'],
    }),
  ],
}

const IMPORTED = {
  ...PREVIEW, dry_run: false, backup_filename: `${VIN}-before-lubelogger-import-20261006-120000.json`,
}

const SUPPLIES = {
  dry_run: true, success_count: 3, skipped_count: 0, error_count: 0, supplies_created: 0, backup_filename: null,
  files: [
    file({
      filename: 'supplies.csv', record_type: 'supply', success_count: 3, row_count: 3, ignored_count: 1,
      supplies: [
        {
          key: '997930|kirkland 5w-30', name: 'Kirkland 5W-30', part_number: '997930', row_count: 2, quantity: 10,
          existing_supply_id: null, existing_supply_name: null, existing_unit_type: null, unit: 'count',
        },
        {
          key: 'p-1|filter', name: 'Filter', part_number: 'P-1', row_count: 1, quantity: 1,
          existing_supply_id: 7, existing_supply_name: 'My filter', existing_unit_type: 'count', unit: 'count',
        },
      ],
    }),
  ],
}

const sent = (call: number): FormData => post.mock.calls[call][1] as FormData
const importButton = () => screen.getByRole('button', { name: /lubelogger\.import$/ })
const previewButton = () => screen.getByRole('button', { name: /lubelogger\.preview$/ })

function chooseFiles(...names: string[]): void {
  fireEvent.change(document.getElementById('lubelogger-files') as HTMLInputElement, {
    target: { files: names.map((n) => new File(['a'], n, { type: 'text/csv' })) },
  })
}

beforeEach(() => vi.clearAllMocks())

describe('LubeLoggerImportPanel', () => {
  it('previews with dry_run, and only then lets the import run', async () => {
    post.mockResolvedValueOnce({ data: PREVIEW })
    render(<LubeLoggerImportPanel vin={VIN} />)
    chooseFiles('fuel.csv', 'repairs.csv')
    expect(importButton()).toBeDisabled()

    fireEvent.click(previewButton())
    await screen.findByText('Row 3: impossible date')
    expect(post.mock.calls[0][0]).toBe(`/import/vehicles/${VIN}/lubelogger`)
    expect(post.mock.calls[0][2]).toEqual({ headers: { 'Content-Type': 'multipart/form-data' } })
    expect(sent(0).get('dry_run')).toBe('true')
    expect(sent(0).getAll('file')).toHaveLength(2)
    expect(sent(0).getAll('record_type')).toEqual(['auto', 'auto'])
    expect(importButton()).toBeEnabled()
  })

  it('changing an option after the preview blocks the import until it is previewed again', async () => {
    post.mockResolvedValueOnce({ data: PREVIEW })
    render(<LubeLoggerImportPanel vin={VIN} />)
    chooseFiles('fuel.csv', 'repairs.csv')
    fireEvent.click(previewButton())
    await screen.findByText('Row 3: impossible date')

    fireEvent.change(document.getElementById('lubelogger-distance') as HTMLSelectElement, { target: { value: 'km' } })
    expect(screen.getByText('lubelogger.stale')).toBeInTheDocument()
    expect(importButton()).toBeDisabled()
  })

  it('imports with the chosen record types and offers the backup', async () => {
    post.mockResolvedValueOnce({ data: PREVIEW })
    render(<LubeLoggerImportPanel vin={VIN} />)
    chooseFiles('fuel.csv', 'repairs.csv')
    fireEvent.click(previewButton())
    await screen.findByText('Row 3: impossible date')

    const [fuelPicker, servicePicker] = screen.getAllByRole('combobox', { name: 'lubelogger.recordType' })
    expect(fuelPicker).toBeDisabled()
    fireEvent.change(servicePicker, { target: { value: 'repair' } })
    // A record type is read the same way as an option, so it needs a fresh preview too.
    expect(importButton()).toBeDisabled()
    post.mockReset()
    post.mockResolvedValueOnce({ data: PREVIEW }).mockResolvedValueOnce({ data: IMPORTED })
    fireEvent.click(previewButton())
    await waitFor(() => expect(importButton()).toBeEnabled())
    fireEvent.click(importButton())

    await screen.findByText(IMPORTED.backup_filename)
    expect(sent(1).get('dry_run')).toBe('false')
    expect(sent(1).getAll('record_type')).toEqual(['fuel', 'repair'])
    expect(screen.getByRole('button', { name: /importExport\.downloadBackup/ })).toBeInTheDocument()
  })

  it('sends the unit picked for each supply, and keeps a matched count supply a count', async () => {
    post.mockResolvedValueOnce({ data: SUPPLIES }).mockResolvedValueOnce({
      data: { ...SUPPLIES, dry_run: false, supplies_created: 1, backup_filename: `${VIN}-b.json` },
    })
    render(<LubeLoggerImportPanel vin={VIN} />)
    chooseFiles('supplies.csv')
    fireEvent.click(previewButton())
    await screen.findByText('Kirkland 5W-30')

    const [oil, filter] = screen.getAllByRole('combobox', { name: 'lubelogger.supplyUnit' })
    expect(filter).toBeDisabled()
    fireEvent.change(oil, { target: { value: 'qt_us' } })
    // A unit pick doesn't change how the file reads, so the preview stays good.
    expect(importButton()).toBeEnabled()
    fireEvent.click(importButton())

    await screen.findByText(`${VIN}-b.json`)
    expect(JSON.parse(sent(1).get('supply_units') as string)).toEqual({
      '997930|kirkland 5w-30': 'qt_us',
      'p-1|filter': 'count',
    })
  })
})
