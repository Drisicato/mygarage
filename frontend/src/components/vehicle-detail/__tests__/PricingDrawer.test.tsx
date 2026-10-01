import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render } from '../../../__tests__/test-utils'
import PricingDrawer from '../PricingDrawer'
import vehicleService from '../../../services/vehicleService'
import type { Vehicle } from '../../../types/vehicle'

vi.mock('../../../services/vehicleService', () => ({
  default: { update: vi.fn() },
}))

const mockedUpdate = vi.mocked(vehicleService).update

const baseVehicle = {
  vin: 'TEST0000000000001',
  nickname: 'Test',
  usage_unit: 'distance',
  secondary_usage_enabled: false,
  purchase_date: '2019-03-15',
  purchase_price: '15000.00',
  sold_date: null,
  sold_price: null,
  msrp_base: '40000.00',
  msrp_options: null,
  destination_charge: null,
  msrp_total: '44095.00',
} as unknown as Vehicle

function renderDrawer(props: Partial<ComponentProps<typeof PricingDrawer>> = {}) {
  const onUpdated = vi.fn()
  const onClose = vi.fn()
  render(
    <PricingDrawer
      open
      onClose={onClose}
      vehicle={baseVehicle}
      vin="TEST0000000000001"
      onUpdated={onUpdated}
      {...props}
    />,
  )
  return { onUpdated, onClose }
}

describe('PricingDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedUpdate.mockResolvedValue(baseVehicle)
  })

  const save = (): void => {
    fireEvent.click(screen.getByRole('button', { name: 'common:save' }))
  }

  it('seeds the form from the vehicle pricing fields', () => {
    renderDrawer()
    expect(screen.getByLabelText('edit.purchaseDate')).toHaveValue('2019-03-15')
    expect(screen.getByLabelText('edit.purchasePrice')).toHaveValue('15000.00')
    expect(screen.getByLabelText('detail.misc.basePrice')).toHaveValue('40000.00')
    expect(screen.getByLabelText('detail.misc.totalMsrp')).toHaveValue('44095.00')
  })

  it('carries no native constraint that could swallow a save', () => {
    // Native min/step on a type=number input blocks a form submit with nothing
    // shown. The prices are checked by hand instead.
    renderDrawer()
    const offenders = Array.from(document.querySelectorAll('input')).filter((el) =>
      ['min', 'max', 'step'].some((attribute) => el.hasAttribute(attribute)),
    )
    expect(offenders.map((el) => el.id)).toEqual([])
  })

  it('saves only the fields that changed, as numbers, in one partial PUT, then closes', async () => {
    const { onUpdated, onClose } = renderDrawer()
    fireEvent.change(screen.getByLabelText('edit.purchasePrice'), { target: { value: '16000' } })
    fireEvent.change(screen.getByLabelText('detail.misc.options'), { target: { value: '2500,50' } })
    save()

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1))
    expect(mockedUpdate).toHaveBeenCalledWith('TEST0000000000001', {
      purchase_price: 16000,
      msrp_options: 2500.5,
    })
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(baseVehicle))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('submits a cleared date or price as null, not an empty string', async () => {
    // An empty string would fail Pydantic parsing; undefined would silently
    // no-op under exclude_unset.
    renderDrawer()
    fireEvent.change(screen.getByLabelText('edit.purchaseDate'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('detail.misc.basePrice'), { target: { value: '' } })
    save()

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalled())
    const [, payload] = mockedUpdate.mock.calls[0]
    expect(payload).toEqual({ purchase_date: null, msrp_base: null })
  })

  it('closes without a PUT when nothing changed', async () => {
    const { onClose } = renderDrawer()
    save()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockedUpdate).not.toHaveBeenCalled()
  })

  // Fable F-B11: the wizard used to accept a negative purchase price, and the
  // API now refuses one. Posting all eight seeded fields made every pricing
  // save on such a vehicle a 422, whatever was edited.
  it('saves an MSRP edit on a vehicle whose legacy purchase price is negative', async () => {
    renderDrawer({ vehicle: { ...baseVehicle, purchase_price: '-5.00' } as unknown as Vehicle })
    fireEvent.change(screen.getByLabelText('detail.misc.basePrice'), { target: { value: '41000' } })
    save()

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1))
    expect(mockedUpdate).toHaveBeenCalledWith('TEST0000000000001', { msrp_base: 41000 })
    expect(screen.queryByText('common:validation.amount.negative')).toBeNull()
  })

  it('asks for 0 or more when the legacy negative price itself is edited', async () => {
    renderDrawer({ vehicle: { ...baseVehicle, purchase_price: '-5.00' } as unknown as Vehicle })
    fireEvent.change(screen.getByLabelText('edit.purchasePrice'), { target: { value: '-6' } })
    save()

    expect(await screen.findByText('common:validation.amount.negative')).toBeInTheDocument()
    expect(mockedUpdate).not.toHaveBeenCalled()
  })

  it.each([
    ['detail.misc.totalMsrp', '10000000000', 'common:validation.amount.tooLarge'],
    ['detail.misc.salePrice', '-1', 'common:validation.amount.negative'],
    ['detail.misc.destination', 'abc', 'common:validation.amount.invalid'],
  ])('refuses %s = %s on the field and sends nothing', async (label, typed, message) => {
    renderDrawer()
    fireEvent.change(screen.getByLabelText(label), { target: { value: typed } })
    save()

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(mockedUpdate).not.toHaveBeenCalled()
  })

  it('a price error clears when that price is edited, and only that one', async () => {
    renderDrawer()
    const errorOf = (id: string): HTMLElement | null => document.getElementById(`${id}-error`)
    fireEvent.change(screen.getByLabelText('edit.purchasePrice'), { target: { value: '-5' } })
    fireEvent.change(screen.getByLabelText('detail.misc.salePrice'), { target: { value: '-5' } })
    save()
    await waitFor(() => expect(errorOf('pricing_purchase_price')).toHaveTextContent('common:validation.amount.negative'))
    expect(errorOf('pricing_sold_price')).toHaveTextContent('common:validation.amount.negative')

    fireEvent.change(screen.getByLabelText('edit.purchasePrice'), { target: { value: '16000' } })
    expect(errorOf('pricing_purchase_price')).toBeNull()
    expect(screen.getByLabelText('edit.purchasePrice')).not.toHaveAttribute('aria-invalid')
    // The sale price wasn't touched, so its error is still true and stays put.
    expect(errorOf('pricing_sold_price')).toHaveTextContent('common:validation.amount.negative')
    expect(mockedUpdate).not.toHaveBeenCalled()
  })

  it('takes MONEY_MAX itself', async () => {
    renderDrawer()
    fireEvent.change(screen.getByLabelText('detail.misc.totalMsrp'), { target: { value: '9999999999.99' } })
    save()

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1))
    expect(mockedUpdate).toHaveBeenCalledWith('TEST0000000000001', { msrp_total: 9999999999.99 })
  })
})
