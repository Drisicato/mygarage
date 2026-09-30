import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../__tests__/test-utils'
import type { SpotRental } from '../../types/spotRental'

const createMutateAsync = vi.fn().mockResolvedValue({})
const updateMutateAsync = vi.fn().mockResolvedValue({})
vi.mock('../../hooks/queries/useSpotRentals', () => ({
  useCreateSpotRental: () => ({ mutateAsync: createMutateAsync }),
  useUpdateSpotRental: () => ({ mutateAsync: updateMutateAsync }),
}))
vi.mock('../../hooks/useCurrencyPreference', () => ({ useCurrencyPreference: () => ({ currencyCode: 'USD', locale: 'en-US', formatCurrency: vi.fn(), symbol: '$' }) }))
vi.mock('../../services/api', () => ({
  default: {
    post: vi.fn().mockResolvedValue({ data: {} }),
    get: vi.fn().mockResolvedValue({ data: { entries: [] } }),
  },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import SpotRentalForm from '../SpotRentalForm'

beforeEach(() => vi.clearAllMocks())

// Ten nights at 45: the stored total is 450, not one night's rate.
const tenNights = (over: Record<string, unknown> = {}): SpotRental => ({
  id: 7, vin: 'V1', location_name: 'Lakeside', location_address: '123 Rd',
  check_in_date: '2026-03-01', check_out_date: '2026-03-11',
  nightly_rate: '45', weekly_rate: null, monthly_rate: null,
  electric: null, water: null, waste: null, total_cost: '450',
  amenities: 'wifi', notes: 'nice', billings: [], created_at: '2026-03-01T00:00:00',
  ...over,
}) as unknown as SpotRental

const save = async (user: ReturnType<typeof userEvent.setup>, name = 'common:update') => {
  await user.click(screen.getByRole('button', { name }))
}

const posted = async (): Promise<Record<string, unknown>> => {
  await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1))
  return updateMutateAsync.mock.calls[0][0]
}

describe('SpotRentalForm edit: clearing clears, and untouched changes nothing', () => {
  it('an untouched edit posts every stored value, the ten-night total included', async () => {
    const user = userEvent.setup()
    render(<SpotRentalForm vin="V1" rental={tenNights()} onClose={vi.fn()} onSuccess={vi.fn()} />)
    await save(user)
    expect(await posted()).toStrictEqual({
      id: 7,
      location_name: 'Lakeside',
      location_address: '123 Rd',
      check_in_date: '2026-03-01',
      check_out_date: '2026-03-11',
      nightly_rate: 45,
      weekly_rate: null,
      monthly_rate: null,
      electric: null,
      water: null,
      waste: null,
      total_cost: 450,
      amenities: 'wifi',
      notes: 'nice',
    })
  })

  it('emptied optional fields post null', async () => {
    const user = userEvent.setup()
    render(
      <SpotRentalForm vin="V1" rental={tenNights({ electric: '30', total_cost: '480' })} onClose={vi.fn()} onSuccess={vi.fn()} />,
    )
    await user.clear(screen.getByLabelText('common:notes'))
    await user.clear(screen.getByLabelText('spotRental.amenities'))
    await user.clear(screen.getByLabelText('spotRental.address'))
    fireEvent.change(screen.getByLabelText('spotRental.checkOutDate'), { target: { value: '' } })
    await save(user)
    const body = await posted()
    expect(body).toMatchObject({ notes: null, amenities: null, location_address: null, check_out_date: null })
  })

  it('switching monthly to nightly posts null for the monthly rate', async () => {
    const user = userEvent.setup()
    render(
      <SpotRentalForm
        vin="V1"
        rental={tenNights({ nightly_rate: null, monthly_rate: '950', total_cost: '950' })}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    )
    await user.selectOptions(screen.getByLabelText('spotRental.rateType'), 'nightly')
    await user.type(screen.getByLabelText('spotRentalForm.nightlyRate'), '50')
    await save(user)
    expect(await posted()).toMatchObject({ nightly_rate: 50, weekly_rate: null, monthly_rate: null, total_cost: 500 })
  })

  it('switching to a rate already stored recomputes the total from it', async () => {
    // Only a seeded record can hold two rates: the switch clears the others.
    const user = userEvent.setup()
    render(
      <SpotRentalForm
        vin="V1"
        rental={tenNights({ monthly_rate: '950', total_cost: '950' })}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    )
    await user.selectOptions(screen.getByLabelText('spotRental.rateType'), 'nightly')
    await save(user)
    expect(await posted()).toMatchObject({ nightly_rate: 45, monthly_rate: null, total_cost: 450 })
  })

  it('switching to a rate type with nothing entered clears the total', async () => {
    const user = userEvent.setup()
    render(
      <SpotRentalForm
        vin="V1"
        rental={tenNights({ nightly_rate: null, monthly_rate: '950', total_cost: '950' })}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    )
    await user.selectOptions(screen.getByLabelText('spotRental.rateType'), 'nightly')
    await save(user)
    expect(await posted()).toMatchObject({ monthly_rate: null, total_cost: null })
  })

  it('editing a utility recomputes the total over the whole stay', async () => {
    const user = userEvent.setup()
    render(<SpotRentalForm vin="V1" rental={tenNights()} onClose={vi.fn()} onSuccess={vi.fn()} />)
    await user.type(screen.getByLabelText('spotRental.electric'), '30')
    await save(user)
    expect(await posted()).toMatchObject({ electric: 30, total_cost: 480 })
  })
})

describe('SpotRentalForm create: the nightly suggestion covers the stay', () => {
  const fillDates = (checkIn: string, checkOut?: string) => {
    fireEvent.change(screen.getByLabelText('spotRental.checkInDate *'), { target: { value: checkIn } })
    if (checkOut) fireEvent.change(screen.getByLabelText('spotRental.checkOutDate'), { target: { value: checkOut } })
  }

  it('suggests the nightly rate times the nights', async () => {
    const user = userEvent.setup()
    render(<SpotRentalForm vin="V1" onClose={vi.fn()} onSuccess={vi.fn()} />)
    fillDates('2026-03-01', '2026-03-11')
    await user.type(screen.getByLabelText('spotRentalForm.nightlyRate'), '45')
    await save(user, 'common:create')
    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1))
    expect(createMutateAsync.mock.calls[0][0]).toMatchObject({ nightly_rate: 45, total_cost: 450 })
  })

  it('an ongoing stay suggests one night', async () => {
    const user = userEvent.setup()
    render(<SpotRentalForm vin="V1" onClose={vi.fn()} onSuccess={vi.fn()} />)
    fillDates('2026-03-01')
    await user.type(screen.getByLabelText('spotRentalForm.nightlyRate'), '45')
    await save(user, 'common:create')
    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1))
    expect(createMutateAsync.mock.calls[0][0]).toMatchObject({ nightly_rate: 45, total_cost: 45 })
  })
})
