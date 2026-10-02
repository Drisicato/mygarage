import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, screen } from '../../__tests__/test-utils' // selects by id (i18n mock renders keys)
import AddressBook, { AddressBookForm, displayCategory } from '../AddressBook'

// vi.mock is hoisted above module-level consts, so spies must be created with vi.hoisted.
const { get, post, put, del } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }))
vi.mock('../../services/api', () => ({ default: { get, post, put, delete: del } }))

beforeEach(() => {
  vi.clearAllMocks()
  get.mockResolvedValue({ data: { entries: [] } })
  post.mockResolvedValue({ data: {} })
  put.mockResolvedValue({ data: {} })
  del.mockResolvedValue({ data: {} })
})

// The form portals through the Drawer, so query the document, not a container.
const formEl = () => document.getElementById('address-book-form') as HTMLFormElement
const categorySelect = () => document.getElementById('category') as HTMLSelectElement
const businessInput = () => document.getElementById('business_name') as HTMLInputElement
const buttonWithText = (text: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(text))

describe('displayCategory', () => {
  it('uses the manual category when set', () => {
    expect(displayCategory({ category: 'Service', poi_category: null })).toBe('Service')
  })
  it('derives Gas Station / RV Park from the POI type when there is no manual category', () => {
    expect(displayCategory({ category: null, poi_category: 'gas_station' })).toBe('Gas Station')
    expect(displayCategory({ category: '', poi_category: 'rv_shop' })).toBe('RV Park')
    expect(displayCategory({ category: null, poi_category: 'rv_park' })).toBe('RV Park')
  })
  it('files an auto shop under Service; only ev_charging and propane have no chip', () => {
    expect(displayCategory({ category: null, poi_category: 'auto_shop' })).toBe('Service')
    expect(displayCategory({ category: null, poi_category: 'ev_charging' })).toBe('')
    expect(displayCategory({ category: null, poi_category: 'propane' })).toBe('')
    expect(displayCategory({ category: '   ', poi_category: null })).toBe('')
  })

  // The POI Finder and the old fill-up quick add wrote a lowercase 'service' for
  // every place they saved, which matched no chip (#194).
  describe('a place saved before as lowercase service', () => {
    it('follows its POI type to the chip it belongs in', () => {
      expect(displayCategory({ category: 'service', poi_category: 'gas_station' })).toBe('Gas Station')
      expect(displayCategory({ category: 'service', poi_category: 'auto_shop' })).toBe('Service')
    })

    it('is Service when it has no POI type', () => {
      expect(displayCategory({ category: 'service', poi_category: null })).toBe('Service')
    })

    it('has no chip for a POI type without one, like an EV charger the POI Finder saves now', () => {
      expect(displayCategory({ category: 'service', poi_category: 'ev_charging' })).toBe('')
    })

    it('guard: a chip someone picked wins over the POI type (mutant: rule 1 ignores case)', () => {
      expect(displayCategory({ category: 'Service', poi_category: 'gas_station' })).toBe('Service')
    })
  })

  it('matches a chip ignoring case and surrounding spaces', () => {
    expect(displayCategory({ category: ' gas station ', poi_category: null })).toBe('Gas Station')
  })

  it('guard: keeps a custom category as typed (mutant: a category matching no chip returns empty)', () => {
    expect(displayCategory({ category: 'Body Shop', poi_category: null })).toBe('Body Shop')
  })
})

describe('AddressBook page: category chips', () => {
  it('shows a gas station the POI Finder saved as lowercase service under the Gas Station chip', async () => {
    get.mockResolvedValue({
      data: { entries: [{ id: 9, business_name: 'Corner Fuel', category: 'service', poi_category: 'gas_station' }] },
    })
    render(<AddressBook />)
    expect(await screen.findByText('Corner Fuel')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common:addressBook.categoryGasStation' }))

    expect(screen.queryByText('Corner Fuel')).toBeInTheDocument()
  })
})

describe('AddressBookForm — category (no more gas-station checkbox)', () => {
  it('drops the gas-station checkbox entirely', () => {
    render(<AddressBookForm entry={{ id: 1, business_name: 'Shell', poi_category: 'gas_station' } as never} onClose={() => {}} onSuccess={() => {}} />)
    expect(document.getElementById('poi_gas_station')).toBeNull()
  })

  it('pre-selects "Gas Station" for a poi_category=gas_station entry with no manual category', () => {
    render(<AddressBookForm entry={{ id: 1, business_name: 'Shell', category: null, poi_category: 'gas_station' } as never} onClose={() => {}} onSuccess={() => {}} />)
    expect(categorySelect().value).toBe('Gas Station')
  })

  it('pre-selects "RV Park" for an rv_shop POI entry', () => {
    render(<AddressBookForm entry={{ id: 2, business_name: 'Riverside', category: null, poi_category: 'rv_shop' } as never} onClose={() => {}} onSuccess={() => {}} />)
    expect(categorySelect().value).toBe('RV Park')
  })

  it('uses the manual category when one is set', () => {
    render(<AddressBookForm entry={{ id: 3, business_name: 'Summit', category: 'Service', poi_category: null } as never} onClose={() => {}} onSuccess={() => {}} />)
    expect(categorySelect().value).toBe('Service')
  })
})

describe('AddressBookForm — submit never serializes poi_category', () => {
  it('editing a POI entry omits poi_category (backend preserves the discovery value) and keeps category', async () => {
    render(<AddressBookForm entry={{ id: 3, business_name: 'Joe Auto', category: 'Service', poi_category: 'auto_shop' } as never} onClose={() => {}} onSuccess={() => {}} />)
    fireEvent.submit(formEl())
    await waitFor(() => expect(put).toHaveBeenCalled())
    const body = put.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect('poi_category' in body).toBe(false)
    // Untouched, so not sent at all: omitted keeps it.
    expect('category' in body).toBe(false)
  })

  it('adding routes to create with the chosen category and no poi_category', async () => {
    render(<AddressBookForm entry={null} onClose={() => {}} onSuccess={() => {}} />)
    fireEvent.change(businessInput(), { target: { value: 'New Fuel' } })
    fireEvent.change(categorySelect(), { target: { value: 'Gas Station' } })
    fireEvent.submit(formEl())
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(put).not.toHaveBeenCalled()
    const body = post.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(body.business_name).toBe('New Fuel')
    expect(body.category).toBe('Gas Station')
    expect('poi_category' in body).toBe(false)
  })
})

describe('AddressBookForm — delete + notes placeholder', () => {
  it('deletes via the footer Delete button (edit mode) after confirm', async () => {
    const onSuccess = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AddressBookForm entry={{ id: 7, business_name: 'Old Shop' } as never} onClose={() => {}} onSuccess={onSuccess} />)
    const btn = buttonWithText('common:delete')
    expect(btn).toBeTruthy()
    fireEvent.click(btn as HTMLButtonElement)
    await waitFor(() => expect(del).toHaveBeenCalledWith('/address-book/7'))
    expect(onSuccess).toHaveBeenCalled()
  })

  it('renders a real notes placeholder (guards the [object Object] regression)', () => {
    render(<AddressBookForm entry={null} onClose={() => {}} onSuccess={() => {}} />)
    const notes = document.getElementById('notes') as HTMLTextAreaElement
    expect(notes.placeholder).toBe('addressBook.notesPlaceholder')
    expect(notes.placeholder).not.toContain('object Object')
  })
})

describe('AddressBookForm: an untouched edit writes nothing it did not load', () => {
  const lastPut = () => put.mock.calls.at(-1)?.[1] as Record<string, unknown>

  it('keeps a custom stored category as the selected option and does not post it', async () => {
    render(<AddressBookForm entry={{ id: 4, business_name: 'Shine Co', category: 'Detailer', poi_category: null } as never} onClose={() => {}} onSuccess={() => {}} />)
    expect(categorySelect().value).toBe('Detailer')
    fireEvent.submit(formEl())
    await waitFor(() => expect(put).toHaveBeenCalled())
    expect('category' in lastPut()).toBe(false)
  })

  it('does not post a category derived from the POI type', async () => {
    render(<AddressBookForm entry={{ id: 1, business_name: 'Shell', category: null, poi_category: 'gas_station' } as never} onClose={() => {}} onSuccess={() => {}} />)
    fireEvent.submit(formEl())
    await waitFor(() => expect(put).toHaveBeenCalled())
    expect('category' in lastPut()).toBe(false)
  })

  it('does not rewrite where the entry came from', async () => {
    render(<AddressBookForm entry={{ id: 5, business_name: 'Found It', category: null, poi_category: null, source: 'osm' } as never} onClose={() => {}} onSuccess={() => {}} />)
    fireEvent.submit(formEl())
    await waitFor(() => expect(put).toHaveBeenCalled())
    expect('source' in lastPut()).toBe(false)
  })

  it('posts a changed category, and null for a cleared one', async () => {
    render(<AddressBookForm entry={{ id: 3, business_name: 'Summit', category: 'Service', poi_category: null } as never} onClose={() => {}} onSuccess={() => {}} />)
    fireEvent.change(categorySelect(), { target: { value: '' } })
    fireEvent.submit(formEl())
    await waitFor(() => expect(put).toHaveBeenCalled())
    expect(lastPut().category).toBeNull()
  })

  it('sends an emptied email, which the server stores as cleared', async () => {
    render(<AddressBookForm entry={{ id: 6, business_name: 'Mail Co', email: 'a@b.co', category: null, poi_category: null } as never} onClose={() => {}} onSuccess={() => {}} />)
    fireEvent.change(document.getElementById('email') as HTMLInputElement, { target: { value: '' } })
    fireEvent.submit(formEl())
    await waitFor(() => expect(put).toHaveBeenCalled())
    expect(lastPut().email).toBe('')
  })

  it('still marks a new entry as manual', async () => {
    render(<AddressBookForm entry={null} onClose={() => {}} onSuccess={() => {}} />)
    fireEvent.change(businessInput(), { target: { value: 'New Place' } })
    fireEvent.submit(formEl())
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect((post.mock.calls.at(-1)?.[1] as Record<string, unknown>).source).toBe('manual')
  })
})
