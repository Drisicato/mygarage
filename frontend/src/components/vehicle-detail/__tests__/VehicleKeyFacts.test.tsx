import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { render, screen, within } from '../../../__tests__/test-utils'
import type { VehicleDetailStats } from '../../../types/vehicle'
import type { Reminder } from '../../../types/reminder'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, isAuthenticated: false }),
}))

let mockReminders: Partial<Reminder>[] = []
vi.mock('../../../hooks/useReminders', () => ({
  useReminders: () => ({ data: mockReminders }),
}))

import VehicleKeyFacts from '../VehicleKeyFacts'
import { makeDetailStats } from '../../../__tests__/factories'

const VIN = '1HGCM82633A004352'

const STATS: VehicleDetailStats = makeDetailStats({
  overdue_count: 3,
  upcoming_count: 2,
  latest_odometer_km: '160000.00',
  latest_odometer_date: '2026-07-01',
  last_service_date: '2026-06-15',
  last_fillup_date: '2026-07-10',
  spent_this_year: '1234.50',
})

const reminder = (over: Partial<Reminder>): Partial<Reminder> => ({
  id: 1,
  title: 'Oil & Filter Change',
  status: 'pending',
  due_status: 'on_track',
  maintenance_type: 'engine_oil_filter',
  due_date: null,
  progress: 0.5,
  progress_basis: 'distance',
  distance_progress: 0.5,
  km_until_due: '4000',
  ...over,
})

beforeEach(() => {
  mockReminders = []
  localStorage.clear()
})

describe('VehicleKeyFacts', () => {
  it('binds each value to its OWN labelled cell (B9 — swap-proof)', () => {
    render(<VehicleKeyFacts vin={VIN} stats={STATS} />)
    // With no reminder, the first cell keeps the last-service date.
    const service = screen.getByRole('group', { name: 'vehicleStats.lastService' })
    expect(within(service).getByText(/Jun 15, 2026/)).toBeInTheDocument()
    const fillup = screen.getByRole('group', { name: 'vehicleStats.lastFillUp' })
    expect(within(fillup).getByText(/Jul 10, 2026/)).toBeInTheDocument()
    // Spent — real formatCurrency('1234.50') + the year, inside the Spent cell.
    const spent = screen.getByRole('group', { name: 'detail.keyFacts.spent' })
    expect(within(spent).getByText(/1,234\.50/)).toBeInTheDocument()
    expect(within(spent).getByText(/2026/)).toBeInTheDocument()
    // Upcoming reads upcoming_count (2), NOT overdue_count (3) — bound to its cell.
    const upcoming = screen.getByRole('group', { name: 'detail.keyFacts.upcoming' })
    expect(within(upcoming).getByText('2')).toBeInTheDocument()
    expect(within(upcoming).queryByText('3')).not.toBeInTheDocument()
  })

  it('shows the not-specified placeholder in each date cell when dates are null', () => {
    render(<VehicleKeyFacts vin={VIN} stats={{ ...STATS, last_service_date: null, last_fillup_date: null }} />)
    const service = screen.getByRole('group', { name: 'vehicleStats.lastService' })
    const fillup = screen.getByRole('group', { name: 'vehicleStats.lastFillUp' })
    expect(within(service).getByText('detail.notSpecified')).toBeInTheDocument()
    expect(within(fillup).getByText('detail.notSpecified')).toBeInTheDocument()
  })

  it('tracks the oil and filter reminder by default, with a progress bar', () => {
    mockReminders = [
      reminder({ id: 2, title: 'Rotate tires', maintenance_type: 'tire_rotation', due_date: '2026-01-01' }),
      reminder({ id: 1 }),
    ]
    render(<VehicleKeyFacts vin={VIN} stats={STATS} />)
    const cell = screen.getByRole('group', { name: 'detail.keyFacts.reminder' })
    expect(within(cell).getByRole('combobox')).toHaveValue('1')
    expect(within(cell).getByRole('progressbar')).toBeInTheDocument()
    expect(within(cell).getAllByText(/distanceLeft/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('group', { name: 'vehicleStats.lastService' })).not.toBeInTheDocument()
  })

  it('falls back to the soonest-due reminder when there is no oil change', () => {
    mockReminders = [
      reminder({ id: 5, title: 'Later', maintenance_type: 'x', due_date: '2027-01-01' }),
      reminder({ id: 6, title: 'Sooner', maintenance_type: 'y', due_date: '2026-11-01' }),
    ]
    render(<VehicleKeyFacts vin={VIN} stats={STATS} />)
    expect(screen.getByRole('combobox')).toHaveValue('6')
  })

  it('remembers the picked reminder per vehicle and ignores a stale id', () => {
    mockReminders = [
      reminder({ id: 1 }),
      reminder({ id: 2, title: 'Rotate tires', maintenance_type: 'tire_rotation' }),
    ]
    const { unmount } = render(<VehicleKeyFacts vin={VIN} stats={STATS} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } })
    expect(localStorage.getItem(`mygarage:vehicle:${VIN}:keyfact-reminder`)).toBe('2')
    unmount()

    const second = render(<VehicleKeyFacts vin={VIN} stats={STATS} />)
    expect(screen.getByRole('combobox')).toHaveValue('2')
    second.unmount()

    localStorage.setItem(`mygarage:vehicle:${VIN}:keyfact-reminder`, '99')
    render(<VehicleKeyFacts vin={VIN} stats={STATS} />)
    expect(screen.getByRole('combobox')).toHaveValue('1')
  })
})
