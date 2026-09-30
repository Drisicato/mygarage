import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '../../../__tests__/test-utils'
import type { InsurancePolicy } from '../../../types/insurance'

const attach = vi.fn().mockResolvedValue({})
vi.mock('../../../hooks/queries/useInsuranceRecords', () => ({
  useAttachPolicyVehicle: () => ({ mutateAsync: attach, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import AddToPolicyDialog from '../AddToPolicyDialog'

const policy = { id: 3, provider: 'State Farm', policy_number: 'P-1' } as InsurancePolicy

function renderDialog(): void {
  render(<AddToPolicyDialog vin="V1" policies={[policy]} onClose={vi.fn()} onSuccess={vi.fn()} />)
  fireEvent.change(document.getElementById('attach_type') as HTMLSelectElement, { target: { value: 'Liability' } })
}

const add = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'common:add' }))
}

beforeEach(() => vi.clearAllMocks())

// money-fits: the API takes a premium share from 0 to MONEY_MAX
// (9,999,999,999.99). Past it the attach came back a 422 toast.
describe('AddToPolicyDialog: the premium share', () => {
  it.each([
    ['10000000000', 'common:validation.amount.tooLarge'],
    ['-5', 'common:validation.amount.negative'],
    ['abc', 'common:validation.amount.invalid'],
  ])('refuses %s on the field and sends nothing', async (typed, message) => {
    renderDialog()
    fireEvent.change(screen.getByLabelText(/insurance\.vehicleShare/), { target: { value: typed } })
    add()

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(attach).not.toHaveBeenCalled()
  })

  it('sends MONEY_MAX itself, and a blank share as null', async () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText(/insurance\.vehicleShare/), { target: { value: '9999999999.99' } })
    add()
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(1))
    expect(attach.mock.calls[0][0]).toMatchObject({ policyId: 3, vin: 'V1', premium_share: 9999999999.99 })

    fireEvent.change(screen.getByLabelText(/insurance\.vehicleShare/), { target: { value: '' } })
    add()
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(2))
    expect(attach.mock.calls[1][0].premium_share).toBeNull()
  })
})
