"""UI theme constants — the selectable themes: light, dark and dark grey.

The single source of truth for backend-side theme validation. Mirrors the
frontend's ``Theme`` union in ``src/contexts/ThemeContext.tsx``; keep the two in
sync when adding or removing a theme. ``users.theme`` is VARCHAR(10), so a new
key must fit in 10 characters (no migration needed otherwise).
"""

SUPPORTED_THEMES: set[str] = {"light", "dark", "grey"}

DEFAULT_THEME: str = "dark"
