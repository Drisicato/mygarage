import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '../../__tests__/test-utils'
import userEvent from '@testing-library/user-event'

const apiPost = vi.fn()
const apiPatch = vi.fn()
vi.mock('../../services/api', () => ({
  default: {
    post: (...args: unknown[]) => apiPost(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
  },
}))
vi.mock('../../hooks/useCurrencyPreference', () => ({
  useCurrencyPreference: () => ({ currencyCode: 'USD', locale: 'en-US', formatCurrency: vi.fn() }),
}))
vi.mock('../../hooks/useUnitPreference', async () => {
  const { IMPERIAL_UNITS } = await import('@/__tests__/factories')
  return { useUnitPreference: () => ({ system: 'imperial', showBoth: false, units: IMPERIAL_UNITS }) }
})

import WindowStickerUpload from '../WindowStickerUpload'

// What the upload returns: the vehicle row's sticker columns, Decimals as strings.
const extracted = {
  vin: 'V1',
  window_sticker_file_path: '/data/sticker.pdf',
  window_sticker_uploaded_at: '2026-09-29T00:00:00',
  msrp_base: '30000.00',
  msrp_options: null,
  msrp_total: '31500.00',
  destination_charge: '1500.00',
  fuel_economy_city_l_per_100km: '7.84',
  fuel_economy_highway_l_per_100km: '6.53',
  fuel_economy_combined_l_per_100km: null,
  standard_equipment: null,
  optional_equipment: null,
  assembly_location: 'Ohio',
  exterior_color: 'Blu',
  interior_color: 'Black',
  sticker_engine_description: '2.0L I4',
  sticker_transmission_description: 'CVT',
  sticker_drivetrain: null,
  wheel_specs: null,
  tire_specs: null,
  warranty_powertrain: '5yr/60k',
  warranty_basic: null,
  environmental_rating_ghg: '7',
  environmental_rating_smog: '7',
  window_sticker_options_detail: null,
  window_sticker_packages: null,
  window_sticker_parser_used: 'honda',
  window_sticker_confidence_score: '90.00',
}

beforeEach(() => {
  vi.clearAllMocks()
  apiPost.mockResolvedValue({ data: extracted })
  apiPatch.mockResolvedValue({ data: extracted })
})

const reachReview = async (user: ReturnType<typeof userEvent.setup>) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  await user.upload(input, new File(['%PDF-1.4'], 'sticker.pdf', { type: 'application/pdf' }))
  await user.click(screen.getByRole('button', { name: 'windowSticker.uploadAndExtract' }))
  await screen.findByRole('button', { name: 'windowSticker.misc.saveData' })
}

const save = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'windowSticker.misc.saveData' }))

const patched = async (): Promise<Record<string, unknown>> => {
  await vi.waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1))
  expect(apiPatch.mock.calls[0][0]).toBe('/vehicles/V1/window-sticker/data')
  return apiPatch.mock.calls[0][1]
}

describe('WindowStickerUpload review: the PATCH carries only what the user changed', () => {
  it('an untouched review saves nothing and still finishes', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const onSuccess = vi.fn()
    render(<WindowStickerUpload vin="V1" onSuccess={onSuccess} onClose={vi.fn()} />)
    await reachReview(user)
    await save(user)
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(apiPatch).not.toHaveBeenCalled()
  })

  it('clearing the exterior colour posts only that null', async () => {
    const user = userEvent.setup({ applyAccept: false })
    render(<WindowStickerUpload vin="V1" onSuccess={vi.fn()} onClose={vi.fn()} />)
    await reachReview(user)
    await user.clear(screen.getByLabelText('detail.misc.exteriorColor'))
    await save(user)
    expect(await patched()).toStrictEqual({ exterior_color: null })
  })

  it('the drivetrain can be entered', async () => {
    const user = userEvent.setup({ applyAccept: false })
    render(<WindowStickerUpload vin="V1" onSuccess={vi.fn()} onClose={vi.fn()} />)
    await reachReview(user)
    await user.type(screen.getByLabelText('detail.misc.drivetrain'), 'AWD')
    await save(user)
    expect(await patched()).toStrictEqual({ sticker_drivetrain: 'AWD' })
  })

  it('reads a comma-decimal MSRP as 528.25, not a 100x-inflated 52825', async () => {
    const user = userEvent.setup({ applyAccept: false })
    render(<WindowStickerUpload vin="V1" onSuccess={vi.fn()} onClose={vi.fn()} />)
    await reachReview(user)
    await user.clear(screen.getByLabelText('detail.misc.basePrice'))
    await user.type(screen.getByLabelText('detail.misc.basePrice'), '528,25')
    await save(user)
    expect(await patched()).toStrictEqual({ msrp_base: 528.25 })
  })

  it('unparseable MSRP text is an inline error, not a silent blank', async () => {
    const user = userEvent.setup({ applyAccept: false })
    render(<WindowStickerUpload vin="V1" onSuccess={vi.fn()} onClose={vi.fn()} />)
    await reachReview(user)
    await user.clear(screen.getByLabelText('detail.misc.basePrice'))
    await user.type(screen.getByLabelText('detail.misc.basePrice'), 'abc')
    await save(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('common:validation.amount.invalid')
    expect(apiPatch).not.toHaveBeenCalled()
  })

  // money-fits: the API takes an MSRP from 0 to MONEY_MAX (9,999,999,999.99).
  it.each([
    ['10000000000', 'common:validation.amount.tooLarge'],
    ['-5', 'common:validation.amount.negative'],
  ])('an MSRP of %s is an inline error and nothing is sent', async (typed, message) => {
    const user = userEvent.setup({ applyAccept: false })
    render(<WindowStickerUpload vin="V1" onSuccess={vi.fn()} onClose={vi.fn()} />)
    await reachReview(user)
    await user.clear(screen.getByLabelText('detail.misc.totalMsrp'))
    await user.type(screen.getByLabelText('detail.misc.totalMsrp'), typed)
    await save(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(apiPatch).not.toHaveBeenCalled()
  })

  it('a 422 on a field the old list lacked lands inline, not in the banner', async () => {
    const user = userEvent.setup({ applyAccept: false })
    apiPatch.mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Request failed with status code 422',
      // The envelope the backend really sends (utils/error_handlers.py): `details`.
      response: {
        status: 422,
        data: {
          error: true,
          message: 'Validation error',
          details: [
            { type: 'string_too_long', loc: ['body', 'environmental_rating_ghg'], msg: 'String should have at most 10 characters' },
          ],
        },
      },
    })
    render(<WindowStickerUpload vin="V1" onSuccess={vi.fn()} onClose={vi.fn()} />)
    await reachReview(user)
    await user.type(screen.getByLabelText('windowSticker.misc.greenhouseGas'), '+')
    await save(user)
    await vi.waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('alert')).toHaveTextContent('String should have at most 10 characters')
    expect(screen.queryByText('Failed to {{action}}. Please check your input.')).not.toBeInTheDocument()
  })
})

describe('WindowStickerUpload review: fuel economy in the user\'s unit', () => {
  it('shows the stored L/100 km as mpg and posts an edit back as L/100 km', async () => {
    const user = userEvent.setup({ applyAccept: false })
    render(<WindowStickerUpload vin="V1" onSuccess={vi.fn()} onClose={vi.fn()} />)
    await reachReview(user)
    const city = screen.getByLabelText('detail.misc.city') as HTMLInputElement
    // 235.215 / 7.84 = 30.0 mpg
    expect(Number(city.value)).toBeCloseTo(30, 0)
    await user.clear(city)
    await user.type(city, '25')
    await save(user)
    const body = await patched()
    expect(Object.keys(body)).toEqual(['fuel_economy_city_l_per_100km'])
    expect(body.fuel_economy_city_l_per_100km as number).toBeCloseTo(9.41, 2)
  })

  it('an untouched fuel economy is not re-posted when another field changes', async () => {
    const user = userEvent.setup({ applyAccept: false })
    render(<WindowStickerUpload vin="V1" onSuccess={vi.fn()} onClose={vi.fn()} />)
    await reachReview(user)
    await user.clear(screen.getByLabelText('detail.misc.interiorColor'))
    await user.type(screen.getByLabelText('detail.misc.interiorColor'), 'Gray')
    await save(user)
    expect(await patched()).toStrictEqual({ interior_color: 'Gray' })
  })
})
