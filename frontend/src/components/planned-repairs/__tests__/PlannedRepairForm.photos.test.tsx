import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { PlannedRepair } from '../../../types/plannedRepair'

const createMutate = vi.fn()
const updateMutate = vi.fn()
const uploadMutate = vi.fn()
const deleteMutate = vi.fn()

vi.mock('../../../hooks/queries/usePlannedRepairs', () => ({
  useCreatePlannedRepair: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdatePlannedRepair: () => ({ mutateAsync: updateMutate, isPending: false }),
  useUploadPlannedRepairPhoto: () => ({ mutateAsync: uploadMutate, isPending: false }),
  useDeletePlannedRepairPhoto: () => ({ mutateAsync: deleteMutate, isPending: false }),
}))
vi.mock('../../../hooks/queries/useSupplies', () => ({ useSupplies: () => ({ data: { supplies: [] } }) }))
vi.mock('../../../hooks/useUnitPreference', () => ({ useUnitPreference: () => ({ system: 'metric' }) }))
vi.mock('../../../hooks/useUnitFormat', () => ({
  useUnitFormat: () => ({ distance: { label: 'km', format: (v: number) => String(v) } }),
}))
vi.mock('../../../hooks/useCurrencyPreference', () => ({
  useCurrencyPreference: () => ({ currencyCode: 'USD', formatCurrency: (v: number) => String(v) }),
}))
vi.mock('../../../utils/unitFormat', () => ({
  seedUnitField: () => ({ display: '' }),
  canonicalFromUnitField: () => null,
}))
vi.mock('../../VendorSearch', () => ({ default: () => <div /> }))
vi.mock('../../FormModalWrapper', () => ({
  default: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}))

import PlannedRepairForm from '../PlannedRepairForm'

const image = (name: string) => new File(['x'], name, { type: 'image/jpeg' })

const pick = (...files: File[]) =>
  fireEvent.change(screen.getByTestId('repair-photo-input'), { target: { files } })

describe('PlannedRepairForm photos', () => {
  beforeAll(() => {
    let n = 0
    URL.createObjectURL = vi.fn(() => `blob:photo-${n++}`)
    URL.revokeObjectURL = vi.fn()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    createMutate.mockResolvedValue({ id: 7 })
    updateMutate.mockResolvedValue({ id: 7 })
    uploadMutate.mockResolvedValue({ id: 1 })
    deleteMutate.mockResolvedValue(undefined)
  })

  const renderForm = (repair?: PlannedRepair) => {
    const onSuccess = vi.fn()
    render(<PlannedRepairForm vin="V1" repair={repair} onClose={vi.fn()} onSuccess={onSuccess} />)
    return { onSuccess }
  }

  const fillTitleAndSave = async () => {
    const title = document.getElementById('repair-title') as HTMLInputElement
    fireEvent.change(title, { target: { value: 'Fix rust' } })
    fireEvent.submit(document.getElementById('planned-repair-form') as HTMLFormElement)
  }

  it('creates the repair, then uploads each picked photo to it', async () => {
    const first = image('a.jpg')
    const second = image('b.jpg')
    const { onSuccess } = renderForm()
    pick(first, second)
    expect(screen.getAllByRole('img')).toHaveLength(2)

    await fillTitleAndSave()

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(createMutate).toHaveBeenCalledTimes(1)
    expect(uploadMutate).toHaveBeenNthCalledWith(1, { repairId: 7, file: first })
    expect(uploadMutate).toHaveBeenNthCalledWith(2, { repairId: 7, file: second })
  })

  it('ignores files that are not images', () => {
    renderForm()
    pick(new File(['x'], 'notes.pdf', { type: 'application/pdf' }))
    expect(screen.queryAllByRole('img')).toHaveLength(0)
    expect(screen.getByText('plannedRepairs.photoNotImage')).toBeInTheDocument()
  })

  it('drops a picked photo before it is ever uploaded', async () => {
    renderForm()
    pick(image('a.jpg'))
    fireEvent.click(screen.getByRole('button', { name: 'plannedRepairs.removePhoto' }))
    expect(screen.queryAllByRole('img')).toHaveLength(0)

    await fillTitleAndSave()
    await waitFor(() => expect(createMutate).toHaveBeenCalled())
    expect(uploadMutate).not.toHaveBeenCalled()
  })

  it('deletes a removed stored photo when the repair is saved, not before', async () => {
    const repair = {
      id: 7,
      vin: 'V1',
      title: 'Fix rust',
      priority: 'medium',
      parts: [],
      photos: [{ id: 3, created_at: '2026-10-11T00:00:00' }],
    } as unknown as PlannedRepair
    const { onSuccess } = renderForm(repair)

    fireEvent.click(screen.getByRole('button', { name: 'plannedRepairs.removePhoto' }))
    expect(deleteMutate).not.toHaveBeenCalled()

    fireEvent.submit(document.getElementById('planned-repair-form') as HTMLFormElement)
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(updateMutate).toHaveBeenCalledTimes(1)
    expect(deleteMutate).toHaveBeenCalledWith({ repairId: 7, photoId: 3 })
  })

  it('retries an upload without creating the repair a second time', async () => {
    uploadMutate.mockRejectedValueOnce(new Error('boom'))
    const file = image('a.jpg')
    const { onSuccess } = renderForm()
    pick(file)

    await fillTitleAndSave()
    await waitFor(() => expect(uploadMutate).toHaveBeenCalledTimes(1))
    expect(onSuccess).not.toHaveBeenCalled()

    fireEvent.submit(document.getElementById('planned-repair-form') as HTMLFormElement)
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(createMutate).toHaveBeenCalledTimes(1)
    expect(updateMutate).toHaveBeenCalledTimes(1)
    expect(uploadMutate).toHaveBeenCalledTimes(2)
  })
})
