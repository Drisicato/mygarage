/**
 * The window sticker test page's Remove button clears the chosen file (#179 sweep).
 *
 * The drop zone's file input is invisible and stretched over the whole panel, so
 * once a file was chosen it sat on top of Remove and a tap opened the picker
 * instead. jsdom has no layout, so these pin STRUCTURE only: no stretched file
 * input exists while a file is chosen, and Remove brings it back. Whether the
 * click really lands on Remove in a browser is G9's E2E half. Remove also clears
 * the last test's result and its error, so nothing describes a file that's gone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const apiGet = vi.fn()
const apiPost = vi.fn()
vi.mock('../../services/api', () => ({
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../hooks/useCurrencyPreference', () => ({
  useCurrencyPreference: () => ({ currencyCode: 'USD', locale: 'en-US' }),
}))

import WindowStickerTest from '../WindowStickerTest'

const OVERLAY_INPUT = 'input[type="file"].inset-0'

/** Renders the page at its real route and waits for the parser list load to settle. */
async function renderPage(): Promise<HTMLElement> {
  const { container } = render(
    <MemoryRouter initialEntries={['/vehicles/1HGCM82633A004352/window-sticker-test']}>
      <Routes>
        <Route path="/vehicles/:vin/window-sticker-test" element={<WindowStickerTest />} />
      </Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/vehicles/window-sticker/parsers'))
  return container
}

/** Picks a file through the overlay input, the way the picker hands one back. */
function chooseFile(container: HTMLElement): void {
  const input = container.querySelector<HTMLInputElement>(OVERLAY_INPUT)
  expect(input).not.toBeNull()
  const file = new File(['%PDF-1.4'], 'sticker.pdf', { type: 'application/pdf' })
  fireEvent.change(input as HTMLInputElement, { target: { files: [file] } })
}

beforeEach(() => {
  vi.clearAllMocks()
  apiGet.mockResolvedValue({ data: [] })
})

describe('WindowStickerTest drop zone', () => {
  it('takes the invisible file input off the panel once a file is chosen', async () => {
    const container = await renderPage()

    chooseFile(container)

    expect(screen.getByText('sticker.pdf')).toBeInTheDocument()
    expect(container.querySelector(OVERLAY_INPUT)).toBeNull()
  })

  // The last line kills a mutant where the input never comes back after Remove
  // (a removed-once latch on the render condition); checked once by hand.
  it('Remove clears the chosen file and puts the picker input back', async () => {
    const container = await renderPage()
    chooseFile(container)
    expect(container.querySelector(OVERLAY_INPUT)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'common:remove' }))

    expect(screen.queryByText('sticker.pdf')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'windowSticker.testExtraction' })).toBeDisabled()
    expect(container.querySelector(OVERLAY_INPUT)).not.toBeNull()
  })

  // A FAILED result on purpose, so the error line is on screen too. Kills a mutant
  // where Remove clears only a successful result and leaves a failure standing.
  it('Remove also clears the last result and its error', async () => {
    apiPost.mockResolvedValue({
      data: {
        success: false,
        parser_name: 'FordParser',
        manufacturer_detected: 'Ford',
        raw_text: null,
        extracted_data: null,
        validation_warnings: [],
        error: 'No MSRP found on the sticker',
      },
    })
    const container = await renderPage()
    chooseFile(container)

    fireEvent.click(screen.getByRole('button', { name: 'windowSticker.testExtraction' }))
    expect(await screen.findByText('No MSRP found on the sticker')).toBeInTheDocument()
    expect(screen.getByText('windowSticker.extractionFailed')).toBeInTheDocument()
    expect(screen.getByText('FordParser')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common:remove' }))

    expect(screen.queryByText('No MSRP found on the sticker')).not.toBeInTheDocument()
    expect(screen.queryByText('windowSticker.extractionFailed')).not.toBeInTheDocument()
    expect(screen.queryByText('FordParser')).not.toBeInTheDocument()
    expect(screen.getByText('windowSticker.uploadPrompt')).toBeInTheDocument()
  })
})
