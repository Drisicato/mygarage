import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../__tests__/test-utils'
import type { SpotRentalBilling } from '../../types/spotRental'

const createMutateAsync = vi.fn().mockResolvedValue({})
const updateMutateAsync = vi.fn().mockResolvedValue({})
vi.mock('../../hooks/queries/useSpotRentals', () => ({
  useCreateBillingEntry: () => ({ mutateAsync: createMutateAsync }),
  useUpdateBillingEntry: () => ({ mutateAsync: updateMutateAsync }),
}))
// B1: BillingEntryForm renders 5 CurrencyInputPrefix → useCurrencySymbol → useCurrencyPreference → useAuth
// (hooks/useCurrencyPreference.ts). test-utils provides NO AuthProvider, so mock useCurrencyPreference — the SAME
// deterministic mock the shipped P6c-2 form tests use — or the suite throws `useAuth must be used within an
// AuthProvider` before reaching any assertion.
vi.mock('../../hooks/useCurrencyPreference', () => ({ useCurrencyPreference: () => ({ currencyCode: 'USD', locale: 'en-US', formatCurrency: vi.fn(), symbol: '$' }) }))

import BillingEntryForm from '../BillingEntryForm'

beforeEach(() => vi.clearAllMocks())

describe('BillingEntryForm — routing + exact payload (SDQ-C)', () => {
  it('create submits the COMPLETE payload (?? null for untouched fields) and routes to create, never update (fails if a field is dropped or a null coercion is lost)', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn(); const onSuccess = vi.fn()
    render(<BillingEntryForm vin="V1" rentalId={3} onClose={onClose} onSuccess={onSuccess} />)
    // Fill ONLY the required billing_date; every rate stays untouched ⇒ the auto-calc `> 0` guard never fires ⇒
    // total stays undefined ⇒ payload total: null. Deterministic, no auto-calc timing.
    fireEvent.change(screen.getByLabelText('billing.billingDate *'), { target: { value: '2026-03-01' } })
    await user.click(screen.getByRole('button', { name: 'common:create' }))
    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1))
    // Deviation from the brief (verified against real onSubmit/RHF, not papered over): notes defaults to
    // `undefined` (`billing?.notes ?? undefined`), but a defaultValue of `undefined` never gets written onto the
    // uncontrolled <textarea> ref, so its native DOM value stays `''` at submit time. onSubmit only applies
    // `?? null` (not `||`), and `'' ?? null` === `''` — so the real payload carries `notes: ''`, never `null`.
    expect(createMutateAsync.mock.calls[0][0]).toStrictEqual({
      billing_date: '2026-03-01',
      monthly_rate: null,
      electric: null,
      water: null,
      waste: null,
      total: null,
      notes: '',
    })
    expect(updateMutateAsync).not.toHaveBeenCalled()
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('edit submits the UPDATE payload with id + edited note and never calls create (fails if it misroutes, drops the id, or drops a seeded amount)', async () => {
    const billing = {
      id: 5, spot_rental_id: 3, billing_date: '2026-03-01',
      monthly_rate: '100', electric: null, water: null, waste: null, total: '100',
      notes: 'x', created_at: '2026-03-01T00:00:00',
    } as unknown as SpotRentalBilling
    const user = userEvent.setup()
    const onClose = vi.fn(); const onSuccess = vi.fn()
    render(<BillingEntryForm vin="V1" rentalId={3} billing={billing} onClose={onClose} onSuccess={onSuccess} />)
    await user.clear(screen.getByLabelText('common:notes'))
    await user.type(screen.getByLabelText('common:notes'), 'y')
    await user.click(screen.getByRole('button', { name: 'common:update' }))
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1))
    // monthly_rate 100 ⇒ the auto-calc effect recomputes total=100 on mount; electric/water/waste seeded null →
    // default undefined → payload null.
    expect(updateMutateAsync.mock.calls[0][0]).toStrictEqual({
      id: 5,
      billing_date: '2026-03-01',
      monthly_rate: 100,
      electric: null,
      water: null,
      waste: null,
      total: 100,
      notes: 'y',
    })
    expect(createMutateAsync).not.toHaveBeenCalled()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('the Field labels resolve to the controls carrying the expected ids (fails if a Field htmlFor/id association is dropped)', () => {
    render(<BillingEntryForm vin="V1" rentalId={3} onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.getByLabelText('billing.billingDate *')).toHaveAttribute('id', 'billing_date')
    expect(screen.getByLabelText('common:total')).toHaveAttribute('id', 'total')
  })
})

describe('BillingEntryForm: the total follows user edits, never the open', () => {
  // 500 + 40 is 540, but the stored total was adjusted to 560 by hand.
  const adjusted = {
    id: 9, rental_id: 3, billing_date: '2026-03-01', monthly_rate: '500', electric: '40',
    water: null, waste: null, total: '560', notes: 'late fee', created_at: '2026-03-01T00:00:00',
  } as unknown as SpotRentalBilling

  it('a manually adjusted total survives an untouched save', async () => {
    const user = userEvent.setup()
    render(<BillingEntryForm vin="V1" rentalId={3} billing={adjusted} onClose={vi.fn()} onSuccess={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'common:update' }))
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1))
    expect(updateMutateAsync.mock.calls[0][0]).toStrictEqual({
      id: 9,
      billing_date: '2026-03-01',
      monthly_rate: 500,
      electric: 40,
      water: null,
      waste: null,
      total: 560,
      notes: 'late fee',
    })
  })

  it('editing an amount recomputes the total', async () => {
    const user = userEvent.setup()
    render(<BillingEntryForm vin="V1" rentalId={3} billing={adjusted} onClose={vi.fn()} onSuccess={vi.fn()} />)
    await user.type(screen.getByLabelText('billingEntryForm.water'), '25')
    await user.click(screen.getByRole('button', { name: 'common:update' }))
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1))
    expect(updateMutateAsync.mock.calls[0][0]).toMatchObject({ water: 25, total: 565 })
  })
})
