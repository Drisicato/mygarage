/**
 * Applies the authenticated user's saved light/dark theme to the ThemeContext.
 *
 * The server→client half of per-account theme persistence (the write half lives
 * in useThemePreference, which PUTs /auth/me then refreshUser()). Precedence
 * mirrors useAccentSync / useLanguageSync: the DB preference wins over the
 * localStorage seed ThemeProvider starts from, and NULL ("never picked") leaves
 * the local seed untouched.
 *
 * Deliberately depends ONLY on `user.theme`, not on the current `theme`: it
 * re-applies when the DB value changes (login, refreshUser) and stays quiet
 * while the user toggles locally — so it never fights a fresh selection during
 * the window before refreshUser() lands. Applying the same value twice is a
 * no-op (setTheme is idempotent) and never triggers a write (setTheme is local).
 *
 * Mount under both ThemeProvider and AuthProvider (see App.tsx).
 */
import { useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { isTheme, useTheme } from '../contexts/ThemeContext'

export function useThemeSync(): void {
  const { user } = useAuth()
  const { setTheme } = useTheme()

  useEffect(() => {
    const dbTheme = user?.theme
    if (isTheme(dbTheme)) {
      setTheme(dbTheme)
    }
  }, [user?.theme, setTheme])
}
