/**
 * Theme setter that also persists the choice to the signed-in account
 * (PUT /auth/me { theme }) so it follows the user across devices — the write
 * half of per-account theme, mirroring the accent picker's selectAccent.
 *
 * The local apply + localStorage always happen (via ThemeContext.setTheme); the
 * account sync is best-effort and skipped when signed out or auth is disabled.
 * A failed save keeps the local apply — the theme still works on this device.
 *
 * Must be used INSIDE AuthProvider (ThemeProvider itself sits outside it, so
 * ThemeContext stays auth-agnostic — the DB read lives in useThemeSync and the
 * DB write lives here). Use this at every theme-toggle site (RightCluster,
 * Settings) instead of the raw useTheme setters.
 */
import { useCallback } from 'react'
import api from '../services/api'
import { useTheme, type Theme } from '../contexts/ThemeContext'
import { useAuth } from '../contexts/AuthContext'

interface ThemePreference {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

export function useThemePreference(): ThemePreference {
  const { theme, darkTheme, setTheme } = useTheme()
  const { isAuthenticated, authMode, refreshUser } = useAuth()

  const persist = useCallback(
    async (next: Theme): Promise<void> => {
      if (authMode === 'none' || !isAuthenticated) return
      try {
        await api.put('/auth/me', { theme: next })
        await refreshUser()
      } catch {
        // Local apply already happened; account sync is best-effort.
      }
    },
    [authMode, isAuthenticated, refreshUser],
  )

  const setThemePreference = useCallback(
    (next: Theme): void => {
      setTheme(next)
      void persist(next)
    },
    [setTheme, persist],
  )

  const toggleThemePreference = useCallback((): void => {
    setThemePreference(theme === 'light' ? darkTheme : 'light')
  }, [theme, darkTheme, setThemePreference])

  return { theme, setTheme: setThemePreference, toggleTheme: toggleThemePreference }
}
