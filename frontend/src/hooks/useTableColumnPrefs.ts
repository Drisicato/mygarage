/**
 * Which columns a table shows, and in what order, kept in this browser.
 *
 * Saved per table (`table_columns:<tableKey>`) as `{ order, hidden }`. The
 * table passes its full default column order, including columns it only shows
 * for some vehicles (propane, octane, fuel rate), so a column that is absent
 * for one vehicle keeps its place and its hidden state for the next.
 */

import { useCallback, useState } from 'react'

export interface TableColumnPrefs {
  order: string[]
  hidden: string[]
}

const STORAGE_PREFIX = 'table_columns:'

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

/** The saved prefs, or empty ones when nothing (or nothing readable) is saved. */
export function readColumnPrefs(tableKey: string): TableColumnPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + tableKey)
    if (!raw) return { order: [], hidden: [] }
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return { order: [], hidden: [] }
    const { order, hidden } = parsed as Record<string, unknown>
    return {
      order: isStringArray(order) ? order : [],
      hidden: isStringArray(hidden) ? hidden : [],
    }
  } catch {
    return { order: [], hidden: [] }
  }
}

/**
 * The saved order, restricted to the table's known ids, with every id it
 * doesn't name slotted in after its nearest default-order predecessor: a
 * column added in a later release lands where it would by default.
 */
export function mergeColumnOrder(saved: string[], defaults: string[]): string[] {
  const known = new Set(defaults)
  const result = saved.filter((id, i) => known.has(id) && saved.indexOf(id) === i)
  defaults.forEach((id, i) => {
    if (result.includes(id)) return
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const k = result.indexOf(defaults[j])
      if (k !== -1) {
        at = k + 1
        break
      }
    }
    result.splice(at, 0, id)
  })
  return result
}

/** The columns to render: hidden ones dropped, the rest in `order`. */
export function applyColumnPrefs<C extends { id: string }>(
  columns: C[],
  order: string[],
  hidden: string[],
): C[] {
  const rank = new Map(order.map((id, i) => [id, i]))
  return columns
    .filter((c) => !hidden.includes(c.id))
    .sort((a, b) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length))
}

export function useTableColumnPrefs(tableKey: string, defaultOrder: string[]) {
  const [prefs, setPrefs] = useState<TableColumnPrefs>(() => readColumnPrefs(tableKey))

  const order = mergeColumnOrder(prefs.order, defaultOrder)

  const save = useCallback(
    (next: TableColumnPrefs) => {
      setPrefs(next)
      localStorage.setItem(STORAGE_PREFIX + tableKey, JSON.stringify(next))
    },
    [tableKey],
  )

  const toggle = (id: string): void => {
    const hidden = prefs.hidden.includes(id)
      ? prefs.hidden.filter((h) => h !== id)
      : [...prefs.hidden, id]
    save({ order, hidden })
  }

  /** Swap `id` with its neighbour among the columns shown right now. */
  const move = (id: string, direction: -1 | 1, presentIds: string[]): void => {
    const present = order.filter((o) => presentIds.includes(o))
    const from = present.indexOf(id)
    const to = from + direction
    if (from === -1 || to < 0 || to >= present.length) return
    const next = [...order]
    const a = next.indexOf(id)
    const b = next.indexOf(present[to])
    ;[next[a], next[b]] = [next[b], next[a]]
    save({ order: next, hidden: prefs.hidden })
  }

  const reset = (): void => {
    setPrefs({ order: [], hidden: [] })
    localStorage.removeItem(STORAGE_PREFIX + tableKey)
  }

  return { order, hidden: prefs.hidden, toggle, move, reset }
}
