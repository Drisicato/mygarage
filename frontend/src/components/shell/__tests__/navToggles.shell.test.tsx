/**
 * Settings > System > Garage sections can switch off the Address Book and
 * Find POI tabs. Every nav surface (the desktop bar, the 768-899px hamburger
 * panel and the mobile tab bar) must drop them, and keep everything else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { NavToggles } from '../../../utils/navToggles'

const toggles = vi.hoisted(() => ({
  current: { nav_address_book_enabled: true, nav_poi_finder_enabled: true } as NavToggles,
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ navToggles: toggles.current }),
}))
// RightCluster and NavSearch carry their own context needs; not under test here.
vi.mock('../RightCluster', () => ({ default: () => null }))
vi.mock('../NavSearch', () => ({ default: () => null }))

import TopNav from '../TopNav'
import HamburgerPanel from '../HamburgerPanel'
import MobileTabBar from '../MobileTabBar'

const renderIn = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)
const link = (name: string) => screen.queryByRole('link', { name })

describe('switchable nav tabs', () => {
  beforeEach(() => {
    toggles.current = { nav_address_book_enabled: true, nav_poi_finder_enabled: true }
  })

  it('shows both tabs while they are on', () => {
    renderIn(<MobileTabBar />)
    expect(link('nav:contacts')).toBeInTheDocument()
    expect(link('nav:poi')).toBeInTheDocument()
  })

  it('the mobile tab bar drops the tabs switched off, and only those', () => {
    toggles.current = { nav_address_book_enabled: false, nav_poi_finder_enabled: false }
    renderIn(<MobileTabBar />)
    expect(link('nav:contacts')).not.toBeInTheDocument()
    expect(link('nav:poi')).not.toBeInTheDocument()
    expect(link('nav:supplies')).toBeInTheDocument()
    expect(link('nav:settings')).toBeInTheDocument()
  })

  it('the desktop bar drops the address book alone when only it is off', () => {
    toggles.current = { nav_address_book_enabled: false, nav_poi_finder_enabled: true }
    renderIn(<TopNav />)
    expect(link('nav:addressBook')).not.toBeInTheDocument()
    expect(link('nav:findPOI')).toBeInTheDocument()
  })

  it('the hamburger panel drops Find POI when it is off', () => {
    toggles.current = { nav_address_book_enabled: true, nav_poi_finder_enabled: false }
    renderIn(<HamburgerPanel onNavigate={() => {}} />)
    expect(link('nav:findPOI')).not.toBeInTheDocument()
    expect(link('nav:addressBook')).toBeInTheDocument()
  })
})
