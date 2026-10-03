import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NotificationBell from '../NotificationBell'
import api from '../../../services/api'

vi.mock('../../../services/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { items: [] } })),
  },
}))

describe('NotificationBell', () => {
  it('opens a drawer with an empty-inbox state', async () => {
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'notifications' }))
    expect(await screen.findByRole('dialog', { name: 'notifications' })).toBeInTheDocument()
    expect(await screen.findByText('notificationsEmptyTitle')).toBeInTheDocument()
  })

  it('shows no unread badge while the inbox is empty', () => {
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    )
    expect(screen.queryByText('0')).toBeNull()
  })

  it('keeps the accessible name the label alone (no count in it)', () => {
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: 'notifications' })).toBeInTheDocument()
  })

  it('lets clicks pass through the unread badge to the bell (#195)', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        items: [
          {
            id: 'reminder-reminder_overdue-1',
            kind: 'reminder_overdue',
            title: 'Brake inspection',
            body: 'Truck',
            vin: 'VIN00000000000001',
            href: '/vehicles/VIN00000000000001?tab=reminders',
            severity: 'critical',
          },
        ],
      },
    })
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    )
    const count = await screen.findByText('1')
    // The badge overlaps the bell button's corner; without pointer-events-none
    // it swallows the click and the user has to aim past the red box.
    const overlay = count.closest('span[aria-hidden="true"]')
    expect(overlay).not.toBeNull()
    expect(overlay!.className).toContain('pointer-events-none')
  })
})
