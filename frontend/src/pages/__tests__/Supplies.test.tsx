import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '../../__tests__/test-utils'
import type { Supply } from '../../types/supplies'

// Mock the supplies query hooks so this stays a unit test — no real network
// calls needed. The api layer itself is already mocked globally (setup.ts
// mocks axios), so any hook we don't mock here still resolves harmlessly.
const useSuppliesMock = vi.fn()
const useDeleteSupplyMock = vi.fn()

vi.mock('../../hooks/queries/useSupplies', () => ({
  useSupplies: () => useSuppliesMock(),
  useCreateSupply: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
  useUpdateSupply: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
  useDeleteSupply: () => useDeleteSupplyMock(),
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
