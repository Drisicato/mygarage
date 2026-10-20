import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '../../../__tests__/test-utils'

const download = vi.fn()
vi.mock('../../importExport/download', () => ({
  downloadFile: (...a: unknown[]) => download(...a),
  downloadBackup: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('../../../hooks/queries/useQuickEntryVehicles', () => ({
  useQuickEntryVehicles: () => ({
    isLoading: false,
    data: [
      { vin: 'VINA0000000000001', nickname: 'Frontier', year: 2012, make: 'Nissan', model: 'Frontier' },
      { vin: 'VINB0000000000002', nickname: 'Wagon', year: 2020, make: 'Subaru', model: 'Outback' },
    ],
  }),
}))
vi.mock('../../importExport/ImportPanel', () => ({
  default: ({ vin, kind, format }: { vin: string; kind: string; format: string }) => (
    <div>ImportPanel {vin} {kind} {format}</div>
  ),
}))
vi.mock('../../importExport/LubeLoggerImportPanel', () => ({
  default: ({ vin }: { vin: string }) => <div>LubeLoggerImportPanel {vin}</div>,
}))

import SettingsImportExportTab from '../SettingsImportExportTab'

const select = (id: string) => document.getElementById(id) as HTMLSelectElement

beforeEach(() => {
  vi.clearAllMocks()
  download.mockResolvedValue(undefined)
})

describe('SettingsImportExportTab', () => {
  it('imports into the picked vehicle, with every format of the picked record type', () => {
    render(<SettingsImportExportTab />)
    expect(screen.getByText('ImportPanel VINA0000000000001 fuel mygarage')).toBeInTheDocument()
    // Fuel keeps every app it always offered.
    expect([...select('import-export-format').options].map((o) => o.value)).toEqual([
      'mygarage', 'fuelio', 'drivvo', 'tesla', 'external', 'lubelogger',
    ])

    fireEvent.change(select('import-export-vehicle'), { target: { value: 'VINB0000000000002' } })
    fireEvent.change(select('import-export-format'), { target: { value: 'lubelogger' } })
    expect(screen.getByText('LubeLoggerImportPanel VINB0000000000002')).toBeInTheDocument()

    // LubeLogger carries over to a type that has it, and a type without it starts on its first format.
    fireEvent.change(select('import-export-kind'), { target: { value: 'supplies' } })
    expect(select('import-export-format')).toHaveValue('lubelogger')
    fireEvent.change(select('import-export-kind'), { target: { value: 'notes' } })
    expect(screen.getByText('ImportPanel VINB0000000000002 notes mygarage')).toBeInTheDocument()
  })

  it('exports the picked record type for the picked vehicle', async () => {
    render(<SettingsImportExportTab />)
    fireEvent.click(screen.getByRole('tab', { name: /importExport\.exportTab/ }))
    fireEvent.change(select('import-export-kind'), { target: { value: 'supplies' } })
    fireEvent.click(screen.getByRole('button', { name: /importExport\.download/ }))
    await waitFor(() => expect(download).toHaveBeenCalled())
    expect(download.mock.calls[0][0]).toBe('/export/vehicles/VINA0000000000001/supplies/csv')

    fireEvent.change(select('import-export-kind'), { target: { value: 'vehicle' } })
    fireEvent.click(screen.getByRole('button', { name: /importExport\.download/ }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2))
    expect(download.mock.calls[1][0]).toBe('/export/vehicles/VINA0000000000001/json')
  })
})
