import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '../../__tests__/test-utils'
import type { Supply } from '../../types/supplies'

// Mock the supplies query hooks so this stays a unit test — no real network
// calls needed. The api layer itself is already mocked globally (setup.ts
// mocks axios), so any hook we don't mock here still resolves harmlessly.
const useSuppliesMock = vi.fn()
const useDeleteSupplyMock = vi.fn()

const mutationStub = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, variables: undefined })

vi.mock('../../hooks/queries/useSupplies', () => ({
  useSupplies: () => useSuppliesMock(),
  useCreateSupply: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
  useUpdateSupply: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
  useDeleteSupply: () => useDeleteSupplyMock(),
  // The quick-action tests mount the real SupplyHistoryModal, so its hooks
  // need inert stands-ins here too.
  useSupplyHistory: () => ({
    data: { entries: [], on_hand: '0.000', avg_unit_cost: null },
    isLoading: false,
    error: null,
  }),
  useAddPurchase: () => mutationStub(),
  useDeletePurchase: () => mutationStub(),
  useAddAdjustment: () => mutationStub(),
  useDeleteAdjustment: () => mutationStub(),
  useUploadReceipt: () => mutationStub(),
  useDeleteReceipt: () => mutationStub(),
}))

vi.mock('../../hooks/queries/useAddressBook', () => ({
  useAddressBookEntries: () => ({ data: [] }),
}))

vi.mock('../../hooks/queries/useQuickEntryVehicles', () => ({
  useQuickEntryVehicles: () => ({ data: [], isLoading: false }),
}))

// Same mock pattern as DEFRecordList.test.tsx — these hooks need AuthProvider
// otherwise, and it's not under test here.
const unitMock = vi.hoisted(() => ({ system: 'metric' as 'metric' | 'imperial' }))
vi.mock('../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => ({ system: unitMock.system, showBoth: false }),
}))
// The REAL currency hook runs, so a rate option has to survive it. Only the
// signed-in user is faked, and the rate-digits test flips them to yen.
const currencyMock = vi.hoisted(() => ({ code: 'USD' }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { currency_code: currencyMock.code } }),
}))

import Supplies from '../Supplies'

const mockSupply: Supply = {
  id: 1,
  name: 'Motor Oil 5W-30',
  unit_type: 'volume',
  category: 'Fluids',
  part_number: 'MO-530',
  vin: null,
  notes: null,
  on_hand: '10.500',
  avg_unit_cost: '5.25',
  is_active: true,
  is_negative: false,
  created_at: '2026-01-01T00:00:00',
  updated_at: null,
} as Supply

beforeEach(() => {
  vi.clearAllMocks()
  // The view pick persists on purpose, so tests must not inherit each other's.
  localStorage.clear()
  currencyMock.code = 'USD'
  unitMock.system = 'metric'
  useSuppliesMock.mockReturnValue({
    data: { supplies: [mockSupply], total: 1 },
    isLoading: false,
    error: null,
  })
  useDeleteSupplyMock.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
  })
})

describe('Supplies page', () => {
  it('renders the supply list from useSupplies', () => {
    render(<Supplies />)

    expect(screen.getByText('Motor Oil 5W-30')).toBeInTheDocument()
    // The category filter's <option> shares the text, so scope to the chip.
    expect(screen.getAllByText('Fluids').length).toBeGreaterThan(1)
    expect(screen.getByText('MO-530')).toBeInTheDocument()
  })

  it('shows the empty state when there are no supplies', () => {
    useSuppliesMock.mockReturnValue({ data: { supplies: [], total: 0 }, isLoading: false, error: null })
    render(<Supplies />)

    expect(screen.getByText('supplies.noSupplies')).toBeInTheDocument()
  })

  it('opens the form modal when "Add supply" is clicked', () => {
    render(<Supplies />)

    // Select by id, not label text — the global i18n test mock renders keys,
    // so the form isn't visible until the click; the name input only exists
    // once the modal has mounted.
    expect(document.getElementById('name')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('supplies.addSupply'))

    expect(document.getElementById('name')).toBeInTheDocument()
    expect(document.getElementById('unit_type')).toBeInTheDocument()
    // unit_type is only disabled in edit mode — create mode leaves it editable
    expect(document.getElementById('unit_type')).not.toBeDisabled()
  })

  it('disables unit_type when editing an existing supply', () => {
    render(<Supplies />)

    fireEvent.click(screen.getByLabelText('common:edit'))

    expect(document.getElementById('unit_type')).toBeDisabled()
    // is_active toggle only appears on edit
    expect(document.getElementById('is_active')).toBeInTheDocument()
  })
})

describe('Supplies page toolbar: search and filters', () => {
  const fluidsA = { ...mockSupply, id: 11, name: 'Oil A', category: 'fluids' } as Supply
  const fluidsB = { ...mockSupply, id: 12, name: 'Oil B', category: 'Fluids' } as Supply
  const fluidsC = { ...mockSupply, id: 13, name: 'Oil C', category: 'Fluids' } as Supply
  const pinnedOut = {
    ...mockSupply, id: 14, name: 'Truck Brake Pads', category: null,
    vin: '1HGCM82633A004352', on_hand: '0.000',
  } as Supply

  beforeEach(() => {
    useSuppliesMock.mockReturnValue({
      data: { supplies: [fluidsA, fluidsB, fluidsC, pinnedOut], total: 4 },
      isLoading: false,
      error: null,
    })
  })

  it('a search with no hits hides the cards and offers clear filters', () => {
    render(<Supplies />)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nomatch' } })

    expect(screen.queryByText('Oil A')).not.toBeInTheDocument()
    expect(screen.getByText('supplies.showingResults')).toBeInTheDocument()
    expect(screen.getByText('supplies.noMatches')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'supplies.clearFilters' })).toBeInTheDocument()
  })

  it('clear filters restores the cards and drops the showing line', () => {
    render(<Supplies />)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nomatch' } })
    fireEvent.click(screen.getByRole('button', { name: 'supplies.clearFilters' }))

    expect(screen.getByText('Oil A')).toBeInTheDocument()
    expect(screen.queryByText('supplies.showingResults')).not.toBeInTheDocument()
  })

  it('the category select lists each category once, most common spelling', () => {
    render(<Supplies />)

    const select = screen.getByRole('combobox', { name: 'supplies.filterByCategory' })
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'supplies.allCategories', 'Fluids',
    ])
  })

  it('the vehicle select offers all, shared, and the raw VIN when quick entry does not know it', () => {
    render(<Supplies />)

    const select = screen.getByRole('combobox', { name: 'supplies.filterByVehicle' })
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'supplies.allVehicles', 'supplies.sharedVehicle', '1HGCM82633A004352',
    ])
  })

  it('the out of stock chip keeps only zero and negative rows', () => {
    render(<Supplies />)

    fireEvent.click(screen.getByRole('button', { name: 'supplies.outOfStock' }))

    expect(screen.getByText('Truck Brake Pads')).toBeInTheDocument()
    expect(screen.queryByText('Oil A')).not.toBeInTheDocument()
  })
})

describe('Supplies page toolbar: sort, group, view', () => {
  const alpha = { ...mockSupply, id: 21, name: 'Alpha Coolant', category: 'Fluids', on_hand: '5.000' } as Supply
  const zulu = { ...mockSupply, id: 22, name: 'Zulu Grease', category: null, on_hand: '0.000' } as Supply

  beforeEach(() => {
    localStorage.clear()
    useSuppliesMock.mockReturnValue({
      data: { supplies: [alpha, zulu], total: 2 },
      isLoading: false,
      error: null,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const cardNames = () =>
    screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)

  it('sorting by lowest stock reorders the cards', () => {
    render(<Supplies />)
    expect(cardNames()).toEqual(['Alpha Coolant', 'Zulu Grease'])

    fireEvent.click(screen.getByRole('button', { name: 'supplies.sortSupplies' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'supplies.sortByLowestStock' }))

    expect(cardNames()).toEqual(['Zulu Grease', 'Alpha Coolant'])
  })

  it('grouping by category renders group headings with the no-category bucket last', () => {
    render(<Supplies />)

    fireEvent.click(screen.getByRole('button', { name: 'supplies.groupSupplies' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'supplies.groupByCategory' }))

    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings).toHaveLength(2)
    expect(headings[0]).toHaveTextContent('Fluids')
    expect(headings[1]).toHaveTextContent('supplies.noCategory')
  })

  it('the list view toggle renders a table with the fixture row', () => {
    render(<Supplies />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'supplies.listView' }))

    const table = screen.getByRole('table')
    expect(within(table).getByText('Alpha Coolant')).toBeInTheDocument()
  })

  it('the view pick persists and a fresh render starts from it', () => {
    const first = render(<Supplies />)
    fireEvent.click(screen.getByRole('button', { name: 'supplies.listView' }))
    expect(JSON.parse(localStorage.getItem('mygarage:supplies:view')!).view).toBe('list')
    first.unmount()

    render(<Supplies />)
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('a throwing Storage still renders the grid default', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    render(<Supplies />)

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('Alpha Coolant')).toBeInTheDocument()
  })
})

describe('Supplies page: out of stock highlight and the vehicle line', () => {
  const zero = { ...mockSupply, id: 31, name: 'Zero Oil', on_hand: '0.000' } as Supply
  const neg = { ...mockSupply, id: 32, name: 'Neg Oil', on_hand: '-1.000', is_negative: true } as Supply
  const shared = { ...mockSupply, id: 33, name: 'Shared Oil', vin: null } as Supply
  const pinned = { ...mockSupply, id: 34, name: 'Pinned Oil', vin: 'VINUNKNOWN123' } as Supply

  beforeEach(() => {
    localStorage.clear()
  })

  it('a zero-stock supply shows the chip in grid view and in list view', () => {
    useSuppliesMock.mockReturnValue({ data: { supplies: [zero], total: 1 }, isLoading: false, error: null })
    render(<Supplies />)

    // One occurrence is the toolbar filter chip; the second is the card's.
    expect(screen.getAllByText('supplies.outOfStock')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'supplies.listView' }))
    expect(within(screen.getByRole('table')).getByText('supplies.outOfStock')).toBeInTheDocument()
  })

  it('a negative supply keeps the warning line, goes danger, and the chip shows once', () => {
    useSuppliesMock.mockReturnValue({ data: { supplies: [neg], total: 1 }, isLoading: false, error: null })
    render(<Supplies />)

    expect(screen.getByText('supplies.negativeWarning')).toBeInTheDocument()
    const card = screen.getByText('Neg Oil').closest('div[class*="border-danger"]')
    expect(card).not.toBeNull()
    expect(screen.getAllByText('supplies.outOfStock')).toHaveLength(2)
  })

  it('cards carry a vehicle line: shared label or the raw VIN fallback', () => {
    useSuppliesMock.mockReturnValue({ data: { supplies: [shared, pinned], total: 2 }, isLoading: false, error: null })
    render(<Supplies />)

    const sharedCard = screen.getByText('Shared Oil').closest('div[class*="bg-garage-surface"]')
    expect(within(sharedCard as HTMLElement).getByText('supplies.sharedVehicle')).toBeInTheDocument()
    const pinnedCard = screen.getByText('Pinned Oil').closest('div[class*="bg-garage-surface"]')
    expect(within(pinnedCard as HTMLElement).getByText('VINUNKNOWN123')).toBeInTheDocument()
  })
})

describe('Supplies page quick actions', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('the card offers log purchase and adjustment, and purchase opens that form', () => {
    render(<Supplies />)

    expect(screen.getByRole('button', { name: 'supplies.history.logAdjustment' })).toBeInTheDocument()
    expect(document.getElementById('purchase-date')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'supplies.history.logPurchase' }))

    expect(document.getElementById('purchase-date')).toBeInTheDocument()
  })

  it('list rows carry the same quick actions', () => {
    render(<Supplies />)

    fireEvent.click(screen.getByRole('button', { name: 'supplies.listView' }))

    const table = screen.getByRole('table')
    expect(within(table).getByRole('button', { name: 'supplies.history.logPurchase' })).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'supplies.history.logAdjustment' })).toBeInTheDocument()
  })
})

describe('SupplyForm category suggestions', () => {
  it('the add form offers one datalist option per canonical category', () => {
    useSuppliesMock.mockReturnValue({
      data: {
        supplies: [
          { ...mockSupply, id: 41, category: 'fluids' },
          { ...mockSupply, id: 42, category: 'Fluids' },
          { ...mockSupply, id: 43, category: 'Fluids' },
        ],
        total: 3,
      },
      isLoading: false,
      error: null,
    })
    render(<Supplies />)

    fireEvent.click(screen.getByText('supplies.addSupply'))

    // The form modal portals, so query the document, not the container.
    const datalist = document.querySelector('datalist#supply-category-suggestions')
    expect(datalist).not.toBeNull()
    expect([...datalist!.querySelectorAll('option')].map((o) => o.value)).toEqual(['Fluids'])
    expect(document.getElementById('category')).toHaveAttribute('list', 'supply-category-suggestions')
  })
})

describe('Supplies page — the average unit cost is a rate', () => {
  it('shows a yen unit cost with its decimals', () => {
    currencyMock.code = 'JPY'
    useSuppliesMock.mockReturnValue({
      data: { supplies: [{ ...mockSupply, avg_unit_cost: '170.5' }], total: 1 },
      isLoading: false,
      error: null,
    })
    render(<Supplies />)

    expect(screen.getByText('¥170.50')).toBeInTheDocument()
    expect(screen.queryByText('¥171')).not.toBeInTheDocument()
  })

  it('leaves the dollar unit cost where it was', () => {
    render(<Supplies />)
    expect(screen.getByText('$5.25')).toBeInTheDocument()
  })
})

describe('Supplies page: the unit cost is per the unit the stock is shown in', () => {
  // 5 qt for $25 is stored as 4.732 L, so the API's average is $5.2832 per litre.
  const perLitre = { ...mockSupply, avg_unit_cost: String(25 / 4.732) }

  it('prices a quart for an imperial user', () => {
    unitMock.system = 'imperial'
    useSuppliesMock.mockReturnValue({ data: { supplies: [perLitre], total: 1 }, isLoading: false, error: null })
    render(<Supplies />)

    expect(screen.getByText('$5.00')).toBeInTheDocument()
    expect(screen.queryByText('$5.28')).not.toBeInTheDocument()
    expect(screen.getByText('supplies.avgCostPerUnit')).toBeInTheDocument()
  })

  it('prices a litre for a metric user', () => {
    useSuppliesMock.mockReturnValue({ data: { supplies: [perLitre], total: 1 }, isLoading: false, error: null })
    render(<Supplies />)

    expect(screen.getByText('$5.28')).toBeInTheDocument()
    expect(screen.getByText('supplies.avgCostPerUnit')).toBeInTheDocument()
  })

  it('keeps the plain label for a counted supply', () => {
    unitMock.system = 'imperial'
    useSuppliesMock.mockReturnValue({
      data: { supplies: [{ ...perLitre, unit_type: 'count', on_hand: '4' }], total: 1 },
      isLoading: false,
      error: null,
    })
    render(<Supplies />)

    expect(screen.getByText('$5.28')).toBeInTheDocument()
    expect(screen.getByText('supplies.avgUnitCost')).toBeInTheDocument()
  })
})
