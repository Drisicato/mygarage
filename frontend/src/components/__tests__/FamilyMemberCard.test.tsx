/**
 * The admin actions on a family member card: the SSO relink, and disable,
 * delete and password reset for SSO users.
 *
 * An SSO user whose identity provider account was re-created can't sign in
 * until an admin allows a one-time relink. The card offers that to SSO users,
 * one tap, and badges the account while the window is open.
 *
 * oidc_relink_until is naive UTC. The file runs in a zone behind UTC, so a
 * plain `new Date()` read of it lands hours late and an expired window looks
 * open.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent } from '../../__tests__/test-utils'
import type { ReactNode } from 'react'
import FamilyMemberCard from '../FamilyMemberCard'
import type { FamilyMemberData } from '@/types/family'
import type { User } from '@/types/user'
import { formatTime } from '@/utils/parseAPITimestamp'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { time?: string }) => (opts?.time ? `${key} ${opts.time}` : key),
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
}))
vi.mock('@/hooks/useTimeFormat', () => ({ useTimeFormat: () => ({ timeFormat: '24h' }) }))

beforeAll(() => {
  vi.stubEnv('TZ', 'America/Chicago')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

const member: FamilyMemberData = {
  id: 7,
  username: 'dana',
  full_name: 'Dana',
  relationship: null,
  relationship_custom: null,
  vehicle_count: 0,
  vehicles: [],
  overdue_maintenance: 0,
  upcoming_maintenance: 0,
  show_on_family_dashboard: true,
  family_dashboard_order: 0,
}

const user = (overrides: Partial<User> = {}): User => ({
  id: 7,
  username: 'dana',
  email: 'dana@example.com',
  full_name: 'Dana',
  is_active: true,
  is_admin: false,
  auth_method: 'oidc',
  oidc_provider: null,
  oidc_relink_until: null,
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
  last_login: null,
  relationship: null,
  relationship_custom: null,
  show_on_family_dashboard: true,
  family_dashboard_order: 0,
  ...overrides,
})

/** The wire form: naive UTC, no offset, as the backend sends it. */
const naiveUtc = (d: Date): string => d.toISOString().replace('Z', '')

const minutesFromNow = (minutes: number): Date => new Date(Date.now() + minutes * 60_000)

const renderCard = (u: User, onToggleRelink = vi.fn()): ReturnType<typeof vi.fn> => {
  render(
    <FamilyMemberCard
      member={member}
      user={u}
      currentUserId={1}
      activeAdminCount={2}
      showActions
      onToggleRelink={onToggleRelink}
    />,
  )
  return onToggleRelink
}

describe('FamilyMemberCard SSO relink', () => {
  it('offers the relink to an SSO user', () => {
    renderCard(user())
    expect(screen.getByTitle('familyCard.allowSsoRelink')).toBeInTheDocument()
  })

  it('does not offer it to a local user', () => {
    renderCard(user({ auth_method: 'local' }))
    expect(screen.queryByTitle('familyCard.allowSsoRelink')).not.toBeInTheDocument()
    expect(screen.queryByTitle('familyCard.cancelSsoRelink')).not.toBeInTheDocument()
  })

  it('does not offer it without admin actions', () => {
    render(<FamilyMemberCard member={member} user={user()} onToggleRelink={vi.fn()} />)
    expect(screen.queryByTitle('familyCard.allowSsoRelink')).not.toBeInTheDocument()
  })

  it('a tap on an unarmed account asks to arm it', () => {
    const onToggleRelink = renderCard(user())
    fireEvent.click(screen.getByTitle('familyCard.allowSsoRelink'))
    expect(onToggleRelink).toHaveBeenCalledTimes(1)
    expect(onToggleRelink).toHaveBeenCalledWith(true)
  })

  it('badges an open relink with its closing time, and a tap cancels it', () => {
    const until = minutesFromNow(20)
    const onToggleRelink = renderCard(user({ oidc_relink_until: naiveUtc(until) }))

    expect(screen.getByText(`familyCard.relinkOpenUntil ${formatTime(until, '24h')}`)).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('familyCard.cancelSsoRelink'))
    expect(onToggleRelink).toHaveBeenCalledWith(false)
  })

  it('an expired relink is not open', () => {
    renderCard(user({ oidc_relink_until: naiveUtc(minutesFromNow(-1)) }))
    expect(screen.queryByText(/familyCard\.relinkOpenUntil/)).not.toBeInTheDocument()
    expect(screen.getByTitle('familyCard.allowSsoRelink')).toBeInTheDocument()
  })

  it('an open relink on a local account still shows, and can be cancelled', () => {
    renderCard(user({ auth_method: 'local', oidc_relink_until: naiveUtc(minutesFromNow(20)) }))
    expect(screen.getByText(/familyCard\.relinkOpenUntil/)).toBeInTheDocument()
    expect(screen.getByTitle('familyCard.cancelSsoRelink')).toBeInTheDocument()
  })
})

/** A card with every admin action wired, for the actions that aren't the relink. */
const renderActions = (u: User, { currentUserId = 1, activeAdminCount = 2 } = {}): void => {
  render(
    <FamilyMemberCard
      member={member}
      user={u}
      currentUserId={currentUserId}
      activeAdminCount={activeAdminCount}
      showActions
      onToggleActive={vi.fn()}
      onDelete={vi.fn()}
      onResetPassword={vi.fn()}
    />,
  )
}

// Disabling is MyGarage's own kill switch and ends a live session at once.
// The IdP never sets it, so SSO users get it like everyone else.
describe('FamilyMemberCard disable and delete', () => {
  it('offers disable for an active SSO user who is not the last admin', () => {
    renderActions(user())
    expect(screen.getByTitle('familyCard.disableUser')).toBeInTheDocument()
  })

  it('offers enable for a disabled SSO user', () => {
    renderActions(user({ is_active: false }))
    expect(screen.getByTitle('familyCard.enableUser')).toBeInTheDocument()
  })

  it.each(['local', 'oidc'] as const)('offers no disable for the last active admin (%s)', (authMethod) => {
    renderActions(user({ auth_method: authMethod, is_admin: true }), { activeAdminCount: 1 })
    expect(screen.queryByTitle('familyCard.disableUser')).not.toBeInTheDocument()
  })

  it('offers delete for an SSO user who is not you', () => {
    renderActions(user())
    expect(screen.getByTitle('familyCard.deleteUser')).toBeInTheDocument()
  })

  it.each(['local', 'oidc'] as const)('offers no delete on your own card (%s)', (authMethod) => {
    renderActions(user({ auth_method: authMethod }), { currentUserId: 7 })
    expect(screen.queryByTitle('familyCard.deleteUser')).not.toBeInTheDocument()
  })

  it('offers a password reset to a local user', () => {
    renderActions(user({ auth_method: 'local' }))
    expect(screen.getByTitle('familyCard.resetPassword')).toBeInTheDocument()
  })

  // The backend refuses a password reset for SSO users, so the card doesn't offer one.
  it('offers no password reset to an SSO user', () => {
    renderActions(user())
    expect(screen.queryByTitle('familyCard.resetPassword')).not.toBeInTheDocument()
  })
})
