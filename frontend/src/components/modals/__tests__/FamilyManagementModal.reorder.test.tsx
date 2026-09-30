/**
 * Family dashboard reorder. Every user's family_dashboard_order defaults to 0,
 * so Move Up/Down used to swap 0 with 0 and nothing moved. A move now writes
 * the new position of every member whose order changes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '../../../__tests__/test-utils'

const { get, updateDashboardMember } = vi.hoisted(() => ({
  get: vi.fn(),
  updateDashboardMember: vi.fn(),
}))
vi.mock('@/services/api', () => ({ default: { get, put: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
vi.mock('@/services/familyService', () => ({
  familyService: {
    getDashboardMembers: vi.fn().mockResolvedValue([]),
    updateDashboardMember: (...args: unknown[]) => updateDashboardMember(...args),
  },
}))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, username: 'alice', is_admin: true } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import FamilyManagementModal from '../FamilyManagementModal'

const member = (id: number, username: string) => ({
  id,
  username,
  email: `${username}@example.com`,
  full_name: null,
  is_admin: id === 1,
  is_active: true,
  auth_method: 'local',
  show_on_family_dashboard: true,
  family_dashboard_order: 0,
})

beforeEach(() => {
  vi.clearAllMocks()
  updateDashboardMember.mockResolvedValue({})
  get.mockImplementation((url: string) => {
    if (url === '/settings') return Promise.resolve({ data: { settings: [{ key: 'auth_mode', value: 'oidc' }] } })
    // Server order is by id; the dashboard sorts ties by username.
    if (url === '/auth/users') return Promise.resolve({ data: [member(3, 'carol'), member(1, 'alice'), member(2, 'bob')] })
    return Promise.resolve({ data: {} })
  })
})

describe('FamilyManagementModal reorder', () => {
  it('moving the third member up, with every order at 0, puts it second', async () => {
    render(<FamilyManagementModal isOpen onClose={vi.fn()} />)
    await screen.findByText('carol')
    const moveUps = await screen.findAllByTitle('familyCard.moveUp')
    fireEvent.click(moveUps[moveUps.length - 1])

    await waitFor(() => expect(updateDashboardMember).toHaveBeenCalled())
    const orders = new Map<number, number>([[1, 0], [2, 0], [3, 0]])
    for (const [id, body] of updateDashboardMember.mock.calls as [number, { family_dashboard_order: number; show_on_family_dashboard: boolean }][]) {
      expect(body.show_on_family_dashboard).toBe(true)
      orders.set(id, body.family_dashboard_order)
    }
    const names = new Map([[1, 'alice'], [2, 'bob'], [3, 'carol']])
    const sorted = [...orders.entries()]
      .sort(([a, oa], [b, ob]) => oa - ob || names.get(a)!.localeCompare(names.get(b)!))
      .map(([id]) => names.get(id))
    expect(sorted).toEqual(['alice', 'carol', 'bob'])
  })
})
