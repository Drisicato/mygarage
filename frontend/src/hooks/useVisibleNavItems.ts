import { useAuth } from '@/contexts/AuthContext'
import { ALL_NAV_SHOWN, type NavToggles } from '@/utils/navToggles'
import type { NavItem } from '@/components/shell/navItems'

/**
 * Which switchable nav tabs are shown (Settings > System > Garage sections).
 *
 * Every tab when there is no answer: outside an AuthProvider `useAuth` throws,
 * and a test's mocked `useAuth` may carry no `navToggles`. The shell then
 * renders exactly as it did before the switches existed. `useAuth` is called
 * unconditionally either way, so the hook order never changes.
 */
export function useNavToggles(): NavToggles {
  try {
    return useAuth().navToggles ?? ALL_NAV_SHOWN
  } catch {
    return ALL_NAV_SHOWN
  }
}

/** `items` without the tabs the household has switched off. */
export function useVisibleNavItems(items: readonly NavItem[]): NavItem[] {
  const toggles = useNavToggles()
  return items.filter((item) => item.toggleKey === undefined || toggles[item.toggleKey])
}
