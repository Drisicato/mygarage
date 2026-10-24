# Fuel History: user-configurable columns

## Context
The Fuel History table (`frontend/src/components/FuelRecordList.tsx`) has a fixed column set and order. The user wants to **show/hide and reorder** columns, with the choice **remembered in this browser** (localStorage, same layout for every vehicle, no backend change).

## Approach

### 1. Column-prefs logic: `frontend/src/hooks/useTableColumnPrefs.ts` (new)
- `useTableColumnPrefs(tableKey: string)` → `{ prefs, toggle(id), move(id, -1 | 1, visibleIds), reset() }`.
- Stored at `localStorage['table_columns:<tableKey>']` as `{ order: string[], hidden: string[] }`; parse leniently (bad JSON means defaults). Same read-on-init / write-on-change pattern as `contexts/AccentContext.tsx`.
- Pure helper `applyColumnPrefs<T>(columns: DataTableColumn<T>[], prefs, pinned: string[])`:
  - sorts columns by `prefs.order`. Ids the saved order doesn't know (e.g. Octane appearing later, or a column added in a future release) keep their default position relative to their neighbours.
  - drops `hidden` ids.
  - keeps `pinned` ids (`actions`) last and always visible.
- Conditional columns (mileage, propane, octane, fuelRate) stay conditional. Prefs only reorder or hide what the vehicle would show anyway, and a hidden id is remembered even while its column isn't present.

### 2. Picker UI: `frontend/src/components/ui/ColumnPicker.tsx` (new, exported from `components/ui/index.ts` per the barrel's reachability rule)
- Props: `label`, `columns: { id, header }[]` (current order, all toggleable columns), `hidden: string[]`, `onToggle`, `onMove`, `onReset`, plus translated strings for move up/down/reset.
- Trigger: a surface button with a columns icon (lucide `Columns3`), styled like `Dropdown`'s default trigger.
- Panel: uses the same full-screen catcher plus `z-dropdown` panel as `ui/Dropdown.tsx`, and closes on Escape or an outside click. **Toggling doesn't close it** (unlike Dropdown, which is a single-select menu, so it can't be reused directly).
- Each row: the `ui/Checkbox` with the column header, then ↑/↓ `IconButton`s (up/down buttons rather than drag, because they're keyboard-accessible and simpler). Edge buttons are disabled, and the last visible column's checkbox is disabled so the table can't be emptied.
- Footer: a "Reset to default" button.

### 3. Wire into `FuelRecordList.tsx`
- `const colPrefs = useTableColumnPrefs('fuel')`, then `const visibleColumns = applyColumnPrefs(columns, colPrefs.prefs, ['actions'])`, and pass `visibleColumns` to `DataTable`.
- Render `<ColumnPicker>` in the header toolbar next to `SearchField` (only when `records.length > 0`). It lists `columns` minus `actions`, in the pref order.

### 4. Strings
- Add to `frontend/src/locales/en/common.json` (generic, reusable by other tables): `columns.button` ("Columns"), `columns.reset` ("Reset to default"), `columns.moveUp` ("Move {{column}} up"), `columns.moveDown` ("Move {{column}} down"). No hardcoded JSX text.

## Files
- new `frontend/src/hooks/useTableColumnPrefs.ts`
- new `frontend/src/components/ui/ColumnPicker.tsx`, plus the export in `components/ui/index.ts` (and a gallery entry if the primitive gallery lists every primitive)
- edit `frontend/src/components/FuelRecordList.tsx`
- edit `frontend/src/locales/en/common.json`
- tests: new `hooks/__tests__/useTableColumnPrefs.test.ts`; extend `components/__tests__/FuelRecordList.test.tsx`

## Verification
- `bun x vitest run src/hooks/__tests__/useTableColumnPrefs.test.ts src/components/__tests__/FuelRecordList.test.tsx`. The new tests cover: hiding a column removes its header; moving one changes header order; prefs survive a remount; an unknown or stale id is handled; Actions stays last; reset restores the default. Existing tests run with `localStorage.clear()` in `beforeEach`.
- `bun x tsc --noEmit`, `bun x eslint` on the touched files, `bun run validate:translations`.
- Manual: run the frontend against the local server (CLAUDE.md "Local server without Docker"), open a vehicle's Fuel tab, hide or reorder columns, reload the page and check the layout persists, then switch vehicles and check the same layout applies.
