import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../__tests__/test-utils'
import type { WarrantyRecord } from '../../types/warranty'

const createMutateAsync = vi.fn()
const updateMutateAsync = vi.fn()
const uploadMutateAsync = vi.fn()
const deleteMutateAsync = vi.fn()
vi.mock('../../hooks/queries/useWarrantyRecords', () => ({
  useCreateWarrantyRecord: () => ({ mutateAsync: createMutateAsync }),
  useUpdateWarrantyRecord: () => ({ mutateAsync: updateMutateAsync }),
  useUploadWarrantyDocument: () => ({ mutateAsync: uploadMutateAsync }),
  useDeleteWarrantyDocument: () => ({ mutateAsync: deleteMutateAsync }),
}))
vi.mock('../../hooks/useUnitPreference', async () => {
  const { IMPERIAL_UNITS } = await import('@/__tests__/factories')
  return {
    useUnitPreference: () => ({ system: 'imperial', showBoth: false, units: IMPERIAL_UNITS, gallonStandard: 'us' }),
  }
})

import WarrantyForm from '../WarrantyForm'

const file = (name: string, type = 'application/pdf', bytes = 10) =>
  new File([new Uint8Array(bytes)], name, { type })

const pick = (...files: File[]) =>
  fireEvent.change(screen.getByTestId('warranty-document-input'), { target: { files } })

const fillRequired = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.selectOptions(screen.getByLabelText('warranty.warrantyType *'), 'Extended')
  await user.clear(screen.getByLabelText('common:startDate *'))
  await user.type(screen.getByLabelText('common:startDate *'), '2026-01-01')
}

const record = {
  id: 7,
  vin: 'V1',
  warranty_type: 'Powertrain',
  provider: 'Honda',
  start_date: '2025-01-01',
  end_date: '2029-01-01',
  mileage_limit_km: null,
  coverage_details: '',
  policy_number: '',
  notes: '',
  documents: [{ id: 3, file_name: 'contract.pdf', file_type: 'application/pdf', file_size: 2048, created_at: '2026-01-01T00:00:00' }],
} as unknown as WarrantyRecord

beforeEach(() => {
  vi.clearAllMocks()
  createMutateAsync.mockResolvedValue({ id: 11 })
  updateMutateAsync.mockResolvedValue({})
  uploadMutateAsync.mockResolvedValue({ id: 1 })
  deleteMutateAsync.mockResolvedValue(undefined)
})

describe('WarrantyForm documents', () => {
  it('a new warranty is created first, then each picked file is uploaded to it', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<WarrantyForm vin="V1" onClose={vi.fn()} onSuccess={onSuccess} />)
    await fillRequired(user)
    const first = file('contract.pdf')
    const second = file('receipt.png', 'image/png')
    pick(first, second)
    expect(screen.getByText('contract.pdf')).toBeInTheDocument()
    expect(screen.getByText('receipt.png')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common:create' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(createMutateAsync).toHaveBeenCalledTimes(1)
    expect(uploadMutateAsync).toHaveBeenNthCalledWith(1, { warrantyId: 11, file: first })
    expect(uploadMutateAsync).toHaveBeenNthCalledWith(2, { warrantyId: 11, file: second })
  })

  it('an edited warranty uploads new files to its own id and shows the stored ones', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<WarrantyForm vin="V1" record={record} onClose={vi.fn()} onSuccess={onSuccess} />)
    expect(screen.getByRole('link', { name: 'warrantyForm.openDocument' })).toHaveAttribute(
      'href',
      expect.stringContaining('/api/vehicles/V1/warranties/7/documents/3'),
    )
    const added = file('claim.pdf')
    pick(added)

    await user.click(screen.getByRole('button', { name: 'common:update' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(createMutateAsync).not.toHaveBeenCalled()
    expect(uploadMutateAsync).toHaveBeenCalledWith({ warrantyId: 7, file: added })
  })

  it('removing a stored document deletes it on save, not before', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<WarrantyForm vin="V1" record={record} onClose={vi.fn()} onSuccess={onSuccess} />)

    await user.click(screen.getByRole('button', { name: 'warrantyForm.removeDocument' }))
    expect(deleteMutateAsync).not.toHaveBeenCalled()
    expect(screen.queryByText('contract.pdf')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common:update' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(deleteMutateAsync).toHaveBeenCalledWith({ warrantyId: 7, documentId: 3 })
  })

  it('refuses an unsupported type and an oversized file with a message', () => {
    render(<WarrantyForm vin="V1" onClose={vi.fn()} onSuccess={vi.fn()} />)
    pick(file('run.exe', 'application/x-msdownload'))
    expect(screen.getByText('warrantyForm.documentBadType')).toBeInTheDocument()
    expect(screen.queryByText('run.exe')).not.toBeInTheDocument()

    pick(file('huge.pdf', 'application/pdf', 26 * 1024 * 1024))
    expect(screen.getByText('warrantyForm.documentTooLarge')).toBeInTheDocument()
    expect(screen.queryByText('huge.pdf')).not.toBeInTheDocument()
  })

  it('a failed upload keeps the form open and a retry does not create the warranty twice', async () => {
    uploadMutateAsync.mockRejectedValueOnce(new Error('boom'))
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<WarrantyForm vin="V1" onClose={vi.fn()} onSuccess={onSuccess} />)
    await fillRequired(user)
    pick(file('contract.pdf'))

    await user.click(screen.getByRole('button', { name: 'common:create' }))
    await waitFor(() => expect(uploadMutateAsync).toHaveBeenCalledTimes(1))
    expect(onSuccess).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'common:create' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(createMutateAsync).toHaveBeenCalledTimes(1)
    expect(updateMutateAsync).toHaveBeenCalledTimes(1)
    expect(uploadMutateAsync).toHaveBeenCalledTimes(2)
  })
})
