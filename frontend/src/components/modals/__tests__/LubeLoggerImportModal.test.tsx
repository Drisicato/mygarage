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

import LubeLoggerImportModal from '../LubeLoggerImportModal'

const VIN = 'VIN00000000000001'

const PREVIEW = {
  files: [
    {
      filename: 'fuel.csv', record_type: 'fuel', electric: false, row_count: 2, error_count: 0,
      ignored_count: 0, errors: [], date_from: '2026-10-06', date_to: '2026-10-20',
      sample: [{ date: '2026-10-06', odometer_km: 115389.96, cost: 42 }],
    },
    {
      filename: 'repairs.csv', record_type: 'service', electric: false, row_count: 1, error_count: 1,
      ignored_count: 0, errors: ['Row 3: impossible date'], date_from: '2026-09-01',
      date_to: '2026-09-01', sample: [{ date: '2026-09-01', description: 'Bumper', cost: 100 }],
    },
  ],
}

const IMPORTED = {
  success_count: 3, error_count: 1, skipped_count: 0,
  files: [
    { filename: 'fuel.csv', record_type: 'fuel', success_count: 2, error_count: 0, skipped_count: 0, errors: [] },
    { filename: 'repairs.csv', record_type: 'repair', success_count: 1, error_count: 1, skipped_count: 0, errors: ['Row 3: impossible date'] },
  ],
  backup_filename: `${VIN}-before-lubelogger-import-20261006-120000.json`,
}

const sent = (call: number): FormData => post.mock.calls[call][1] as FormData

function chooseFiles(): void {
  const input = document.getElementById('lubelogger-files') as HTMLInputElement
  fireEvent.change(input, {
    target: {
      files: [
        new File(['a'], 'fuel.csv', { type: 'text/csv' }),
        new File(['b'], 'repairs.csv', { type: 'text/csv' }),
      ],
    },
  })
}

const importButton = () => screen.getByRole('button', { name: /lubelogger\.import$/ })

beforeEach(() => vi.clearAllMocks())

describe('LubeLoggerImportModal', () => {
  it('previews with dry_run, and only then lets the import run', async () => {
    post.mockResolvedValueOnce({ data: PREVIEW })
    render(<LubeLoggerImportModal vin={VIN} onClose={vi.fn()} />)
    chooseFiles()
    expect(importButton()).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /lubelogger\.preview$/ }))
    await screen.findByText('Row 3: impossible date')

    expect(post.mock.calls[0][0]).toBe(`/import/vehicles/${VIN}/lubelogger`)
    // The api client defaults to JSON; without this the files never arrive (422).
    expect(post.mock.calls[0][2]).toEqual({ headers: { 'Content-Type': 'multipart/form-data' } })
    expect(sent(0).get('dry_run')).toBe('true')
    expect(sent(0).getAll('file')).toHaveLength(2)
    expect(sent(0).get('distance_unit')).toBe('mi')
    expect(importButton()).toBeEnabled()
  })

  it('changing an option after the preview blocks the import until it is previewed again', async () => {
    post.mockResolvedValueOnce({ data: PREVIEW })
    render(<LubeLoggerImportModal vin={VIN} onClose={vi.fn()} />)
    chooseFiles()
    fireEvent.click(screen.getByRole('button', { name: /lubelogger\.preview$/ }))
    await screen.findByText('Row 3: impossible date')

    fireEvent.change(document.getElementById('lubelogger-distance') as HTMLSelectElement, {
      target: { value: 'km' },
    })
    expect(screen.getByText('lubelogger.stale')).toBeInTheDocument()
    expect(importButton()).toBeDisabled()
  })

  it('imports with the chosen record types and offers the backup', async () => {
    post.mockResolvedValueOnce({ data: PREVIEW }).mockResolvedValueOnce({ data: IMPORTED })
    render(<LubeLoggerImportModal vin={VIN} onClose={vi.fn()} />)
    chooseFiles()
    fireEvent.click(screen.getByRole('button', { name: /lubelogger\.preview$/ }))
    await screen.findByText('Row 3: impossible date')

    // The key-only i18n mock drops the file name, so pick the service file's picker.
    const [fuelPicker, servicePicker] = screen.getAllByRole('combobox', { name: 'lubelogger.recordType' })
    expect(fuelPicker).toBeDisabled()
    fireEvent.change(servicePicker, { target: { value: 'repair' } })
    // A record type change is read the same way, so it needs a fresh preview too.
    expect(importButton()).toBeDisabled()
    post.mockReset()
    post.mockResolvedValueOnce({ data: PREVIEW }).mockResolvedValueOnce({ data: IMPORTED })
    fireEvent.click(screen.getByRole('button', { name: /lubelogger\.preview$/ }))
    await waitFor(() => expect(importButton()).toBeEnabled())
    fireEvent.click(importButton())

    await screen.findByText(IMPORTED.backup_filename)
    expect(sent(1).get('dry_run')).toBe('false')
    expect(post.mock.calls[1][2]).toEqual({ headers: { 'Content-Type': 'multipart/form-data' } })
    expect(sent(1).getAll('record_type')).toEqual(['fuel', 'repair'])
    expect(screen.getByRole('button', { name: /lubelogger\.downloadBackup/ })).toBeInTheDocument()
  })
})
