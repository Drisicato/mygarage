import React, { createContext, useContext, useState, useLayoutEffect, useCallback } from 'react';

/** 'grey' is a dark theme: it carries the `dark` class too, so every dark rule
 *  and `classList.contains('dark')` check still applies, and html.grey only
 *  re-points the surface tokens. Mirrors SUPPORTED_THEMES in
 *  backend/app/constants/theme.py; keep the two in sync. */
export type Theme = 'light' | 'dark' | 'grey';
export type DarkTheme = Exclude<Theme, 'light'>;

export const THEMES: readonly Theme[] = ['light', 'dark', 'grey'];

export function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme);
}

/** The light/dark family a theme belongs to (accent foreground, icons). */
export function themeTone(theme: Theme): 'light' | 'dark' {
  return theme === 'light' ? 'light' : 'dark';
}

/** Opaque form of --color-nav per theme (design §4.4 / §4.10). The browser
 *  status bar wants a solid colour; jsdom cannot resolve the @theme rgba(), so
 *  these are pinned constants matching the static index.html value (#0b0e13). */
const NAV_THEME_COLOR: Record<Theme, string> = {
  dark: '#0b0e13',
  grey: '#25262a',
  light: '#ffffff',
};

/** Every class applyTheme may set, so switching removes the previous one. */
const THEME_CLASSES: Record<Theme, string[]> = {
  light: ['light'],
  dark: ['dark'],
  grey: ['dark', 'grey'],
};

interface ThemeContextType {
  theme: Theme;
  /** The dark theme the light/dark toggle returns to: the last one picked. */
  darkTheme: DarkTheme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

interface ThemeProviderProps {
  children: React.ReactNode;
}

/** Read the localStorage theme seed. The index.html bootstrap has already
 *  applied the matching class before first paint, so this only mirrors that
 *  seed into React state — no fetch, no flash. */
function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem('theme');
    return isTheme(stored) ? stored : 'dark';
  } catch {
    return 'dark';
  }
}

function readStoredDarkTheme(): DarkTheme {
  try {
    return localStorage.getItem('darkTheme') === 'grey' ? 'grey' : 'dark';
  } catch {
    return 'dark';
  }
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  // Seeded synchronously from localStorage. The per-account theme (user.theme)
  // is applied over this seed by useThemeSync once auth resolves — mirroring the
  // accent architecture, ThemeProvider stays auth-agnostic (it mounts outside
  // AuthProvider) and handles only the local apply + localStorage. The account
  // write (PUT /auth/me) lives in useThemePreference at the toggle sites.
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [darkTheme, setDarkTheme] = useState<DarkTheme>(() => {
    const seed = readStoredTheme();
    return seed === 'light' ? readStoredDarkTheme() : seed;
  });

  const applyTheme = useCallback((newTheme: Theme) => {
    const html = document.documentElement;
    html.classList.remove('light', 'dark', 'grey');
    html.classList.add(...THEME_CLASSES[newTheme]);
    // theme-color tracks the app bar (--color-nav), not the accent (§4.10).
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', NAV_THEME_COLOR[newTheme]);
    }
  }, []);

  // Apply before paint on mount and whenever the theme changes (toggle or
  // useThemeSync). The bootstrap already applied the initial class, so the mount
  // pass is an idempotent no-op that also keeps meta[theme-color] correct.
  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
    if (newTheme !== 'light') {
      setDarkTheme(newTheme);
      localStorage.setItem('darkTheme', newTheme);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'light' ? darkTheme : 'light');
  }, [theme, darkTheme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, darkTheme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
