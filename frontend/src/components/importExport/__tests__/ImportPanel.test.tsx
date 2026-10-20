import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { render } from '../../../__tests__/test-utils'

const post = vi.fn()
const get = vi.fn()
vi.mock('@/services/api', () => ({
  default: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
const units = vi.hoisted(() => ({ distance: 'mi' as 'mi' | 'km' }))
vi.mock('@/hooks/useUnitPreference', () => ({
  useUnitPreference: () => ({ units: { distance: units.distance } }),
}))

import ImportPanel from '../ImportPanel'

const VIN = 'VIN00000000000001'
const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } }

const sent = (call: number): FormData => post.mock.calls[call][1] as FormData
const previewButton = () => screen.getByRole('button', { name: /importExport\.preview$/ })
const importButton = () => screen.getByRole('button', { name: /importExport\.import$/ })

function chooseFile(name = 'fuel.csv'): File {
  const file = new File(['Date,Odometer\n2026-01-01,1000\n'], name, { type: 'text/csv' })
  fireEvent.change(document.getElementById('import-file') as HTMLInputElement, { target: { files: [file] } })
  return file
}

beforeEach(() => {
  vi.clearAllMocks()
  units.distance = 'mi'
})

describe('ImportPanel', () => {
  it('previews with dry_run, and only then lets the import run, which reports its backup', async () => {
    post
      .mockResolvedValueOnce({
        data: { success_count: 2, skipped_count: 1, error_count: 1, errors: ['Row 4: bad date'], dry_run: true, backup_filename: null },
      })
      .mockResolvedValueOnce({
        data: { success_count: 2, skipped_count: 1, error_count: 1, errors: [], dry_run: false, backup_filename: `${VIN}-before-import-1.json` },
      })
    render(<ImportPanel vin={VIN} kind="service" format="mygarage" />)
    const file = chooseFile()
    expect(importButton()).toBeDisabled()

    fireEvent.click(previewButton())
    await screen.findByText('Row 4: bad date')
    expect(post.mock.calls[0][0]).toBe(`/import/vehicles/${VIN}/service/csv`)
    // The api client defaults to JSON; without this the file never arrives.
    expect(post.mock.calls[0][2]).toEqual(MULTIPART)
    expect(sent(0).get('file')).toBe(file)
    expect(sent(0).get('dry_run')).toBe('true')
    // MyGarage's CSV names its own units: nothing to ask.
    expect(sent(0).has('odometer_unit')).toBe(false)

    expect(importButton()).toBeEnabled()
    fireEvent.click(importButton())
    await screen.findByText(`${VIN}-before-import-1.json`)
    expect(sent(1).get('dry_run')).toBe('false')
    expect(screen.getByRole('button', { name: /importExport\.downloadBackup/ })).toBeInTheDocument()
  })

  it('an import marks every query stale (#192: a vehicle import writes reminders and readings too)', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    post
      .mockResolvedValueOnce({ data: { success_count: 1, skipped_count: 0, error_count: 0, errors: [], dry_run: true } })
      .mockResolvedValueOnce({ data: { success_count: 1, skipped_count: 0, error_count: 0, errors: [], backup_filename: 'b.json' } })
    render(<ImportPanel vin={VIN} kind="vehicle" format="json" />)
    chooseFile('vehicle.json')
    fireEvent.click(previewButton())
    await waitFor(() => expect(importButton()).toBeEnabled())
    // A preview writes nothing, so nothing goes stale.
    expect(invalidate).not.toHaveBeenCalled()
    fireEvent.click(importButton())
    await screen.findByText('b.json')
    // No key: vehicle-scoped keys don't share one shape (insurance puts the VIN third).
    expect(invalidate).toHaveBeenCalledWith()
    invalidate.mockRestore()
  })

  it('another app\'s fuel export posts the odometer unit and decimal style (G5a-82)', async () => {
    post.mockResolvedValue({ data: { success_count: 1, skipped_count: 0, error_count: 0, errors: [], dry_run: true } })
    render(<ImportPanel vin={VIN} kind="fuel" format="fuelio" />)
    chooseFile()
    // A miles account starts on miles.
    expect(document.getElementById('import-odometer-unit')).toHaveValue('mi')
    fireEvent.change(document.getElementById('import-decimal') as HTMLSelectElement, { target: { value: 'comma' } })

    fireEvent.click(previewButton())
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(post.mock.calls[0][0]).toBe(`/import/vehicles/${VIN}/fuel/fuelio`)
    expect(sent(0).get('odometer_unit')).toBe('mi')
    expect(sent(0).get('decimal_separator')).toBe('comma')
  })

  it('changing an option after the preview blocks the import until it is previewed again', async () => {
    post.mockResolvedValue({ data: { success_count: 1, skipped_count: 0, error_count: 0, errors: [], dry_run: true } })
    render(<ImportPanel vin={VIN} kind="fuel" format="drivvo" />)
    chooseFile()
    fireEvent.click(previewButton())
    await waitFor(() => expect(importButton()).toBeEnabled())

    fireEvent.change(document.getElementById('import-odometer-unit') as HTMLSelectElement, { target: { value: 'km' } })
    expect(screen.getByText('importExport.stale')).toBeInTheDocument()
    expect(importButton()).toBeDisabled()
  })

  it('a whole-vehicle JSON import adds up its sections', async () => {
    post.mockResolvedValue({
      data: {
        dry_run: true,
        fuel_records: { success_count: 3, skipped_count: 1, error_count: 0 },
        notes: { success_count: 2, skipped_count: 0, error_count: 1 },
        errors: ['Note 2: could not be imported'],
      },
    })
    render(<ImportPanel vin={VIN} kind="vehicle" format="json" />)
    chooseFile('vehicle.json')
    fireEvent.click(previewButton())
    await screen.findByText('Note 2: could not be imported')
    expect(post.mock.calls[0][0]).toBe(`/import/vehicles/${VIN}/json`)
    expect(screen.getByRole('button', { name: /importExport\.import$/ })).toBeEnabled()
  })
})
