import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '../../__tests__/test-utils'
import AddressBookQuickAddModal from '../AddressBookQuickAddModal'

// vi.mock is hoisted above module-level consts, so the spy has to come from vi.hoisted.
const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('../../services/api', () => ({ default: { post } }))

beforeEach(() => {
  vi.clearAllMocks()
  post.mockResolvedValue({ data: { id: 1, business_name: 'Shell' } })
})

// Fill nothing but the prefilled name and hit the footer Add, which submits by form id.
const submitQuickAdd = async (props: { poiCategory?: string }): Promise<Record<string, unknown>> => {
  const user = userEvent.setup()
  render(
    <AddressBookQuickAddModal
      isOpen
      nested
      onClose={vi.fn()}
      onAdded={vi.fn()}
      initialName="Shell"
      {...props}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'addressBookQuickAdd.add' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>]
  expect(url).toBe('/address-book')
  return body
}

describe('AddressBookQuickAddModal (Drawer-backed)', () => {
  it('renders a labelled nested dialog with the footer Add action', () => {
    render(
      <AddressBookQuickAddModal isOpen nested onClose={vi.fn()} onAdded={vi.fn()} title="Add station" />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Add station' })
    expect(dialog).toHaveClass('z-drawer-nested') // nested -> +10 panel token, mirrors the Drawer nested test
    expect(screen.getByRole('button', { name: 'addressBookQuickAdd.add' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'addressBookQuickAdd.add' })).toHaveAttribute(
      'form',
      'ab-quick-add-form',
    )
    expect(screen.getByRole('dialog').querySelector('#ab-quick-add-form')).toBeInTheDocument()
  })
})

describe('AddressBookQuickAddModal POST body (#194)', () => {
  it('files a station added from a fill-up under the Gas Station chip', async () => {
    // Used to post 'service', so the station never showed under Gas Station.
    const body = await submitQuickAdd({ poiCategory: 'gas_station' })
    expect(body.category).toBe('Gas Station')
    expect(body.poi_category).toBe('gas_station')
    expect(body.business_name).toBe('Shell')
  })

  it('files anything else under the Service chip, capitalised like the chip', async () => {
    // Lowercase 'service' matched no chip on the Address Book page.
    const body = await submitQuickAdd({})
    expect(body.category).toBe('Service')
    expect(body.poi_category).toBeUndefined()
  })
})
