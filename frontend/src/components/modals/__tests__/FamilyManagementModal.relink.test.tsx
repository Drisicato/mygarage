/**
 * Allowing and cancelling an SSO relink from Family Management. The card only
 * reports the tap; the modal makes the call, refreshes the users and says what
 * happened.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '../../../__tests__/test-utils'

const { get, post, del, toastSuccess, toastError } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))
vi.mock('@/services/api', () => ({ default: { get, put: vi.fn(), post, delete: del } }))
vi.mock('@/services/familyService', () => ({
  familyService: {
    getDashboardMembers: vi.fn().mockResolvedValue([]),
    updateDashboardMember: vi.fn(),
  },
}))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, username: 'alice', is_admin: true } }),
}))
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))

import FamilyManagementModal from '../FamilyManagementModal'

const naiveUtcMinutesFromNow = (minutes: number): string =>
  new Date(Date.now() + minutes * 60_000).toISOString().replace('Z', '')

const account = (id: number, username: string, relinkUntil: string | null = null): Record<string, unknown> => ({
  id,
  username,
  email: `${username}@example.com`,
  full_name: null,
  is_admin: id === 1,
  is_active: true,
  auth_method: id === 1 ? 'local' : 'oidc',
  oidc_relink_until: relinkUntil,
  show_on_family_dashboard: true,
  family_dashboard_order: id,
})

/** A promise the test settles by hand, to see what happens before and after. */
const deferred = (): { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void } => {
  let resolve!: (v: unknown) => void
  let reject!: (e: unknown) => void
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const usersListCalls = (): number => get.mock.calls.filter(([url]) => url === '/auth/users').length

const serve = (users: Record<string, unknown>[]): void => {
  get.mockImplementation((url: string) => {
    if (url === '/settings') return Promise.resolve({ data: { settings: [{ key: 'auth_mode', value: 'oidc' }] } })
    if (url === '/auth/users') return Promise.resolve({ data: users })
    return Promise.resolve({ data: {} })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('FamilyManagementModal SSO relink', () => {
  it('a tap on an SSO user posts the relink, then toasts and refreshes the users', async () => {
    serve([account(1, 'alice'), account(2, 'bob')])
    const call = deferred()
    post.mockReturnValue(call.promise)

    render(<FamilyManagementModal isOpen onClose={vi.fn()} />)
    fireEvent.click(await screen.findByTitle('familyCard.allowSsoRelink'))

    await waitFor(() => expect(post).toHaveBeenCalledWith('/auth/users/2/oidc-relink'))
    const listedBefore = usersListCalls()
    expect(toastSuccess).not.toHaveBeenCalled()

    call.resolve({ data: account(2, 'bob', naiveUtcMinutesFromNow(30)) })

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('modal.ssoRelinkAllowed'))
    await waitFor(() => expect(usersListCalls()).toBeGreaterThan(listedBefore))
    expect(del).not.toHaveBeenCalled()
  })

  it('a tap on an open relink deletes it, then toasts', async () => {
    serve([account(1, 'alice'), account(2, 'bob', naiveUtcMinutesFromNow(20))])
    del.mockResolvedValue({ data: account(2, 'bob') })

    render(<FamilyManagementModal isOpen onClose={vi.fn()} />)
    fireEvent.click(await screen.findByTitle('familyCard.cancelSsoRelink'))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('modal.ssoRelinkCancelled'))
    expect(del).toHaveBeenCalledWith('/auth/users/2/oidc-relink')
    expect(post).not.toHaveBeenCalled()
  })

  it('a refused call says so and claims nothing', async () => {
    serve([account(1, 'alice'), account(2, 'bob')])
    post.mockRejectedValue(Object.assign(new Error('nope'), { response: { status: 403, data: { detail: 'User does not have admin privileges' } } }))

    render(<FamilyManagementModal isOpen onClose={vi.fn()} />)
    fireEvent.click(await screen.findByTitle('familyCard.allowSsoRelink'))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})
