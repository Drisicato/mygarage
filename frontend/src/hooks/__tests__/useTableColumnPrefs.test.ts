import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  applyColumnPrefs,
  mergeColumnOrder,
  readColumnPrefs,
  useTableColumnPrefs,
} from '../useTableColumnPrefs'

const DEFAULTS = ['date', 'mileage', 'volume', 'propane', 'cost']

beforeEach(() => {
  localStorage.clear()
})

describe('mergeColumnOrder', () => {
  it('returns the defaults when nothing is saved', () => {
    expect(mergeColumnOrder([], DEFAULTS)).toEqual(DEFAULTS)
  })

  it('keeps the saved order and drops ids the table no longer has', () => {
    expect(mergeColumnOrder(['cost', 'gone', 'date', 'volume', 'mileage', 'propane'], DEFAULTS))
      .toEqual(['cost', 'date', 'volume', 'mileage', 'propane'])
  })

  it('slots an id the saved order lacks in after its default predecessor', () => {
    // `propane` follows `volume` by default, so it lands right after it.
    expect(mergeColumnOrder(['cost', 'volume', 'date', 'mileage'], DEFAULTS))
      .toEqual(['cost', 'volume', 'propane', 'date', 'mileage'])
  })

  it('puts a missing first default at the front', () => {
    expect(mergeColumnOrder(['cost', 'volume'], ['date', 'volume', 'cost'])).toEqual(['date', 'cost', 'volume'])
  })
})

describe('applyColumnPrefs', () => {
  const cols = [{ id: 'date' }, { id: 'volume' }, { id: 'cost' }]

  it('orders by the saved order and drops hidden columns', () => {
    expect(applyColumnPrefs(cols, ['cost', 'date', 'volume'], ['date']).map((c) => c.id))
      .toEqual(['cost', 'volume'])
  })
})

describe('readColumnPrefs', () => {
  it('reads unreadable storage as no prefs', () => {
    localStorage.setItem('table_columns:fuel', '{not json')
    expect(readColumnPrefs('fuel')).toEqual({ order: [], hidden: [] })
    localStorage.setItem('table_columns:fuel', JSON.stringify({ order: 'x', hidden: [1] }))
    expect(readColumnPrefs('fuel')).toEqual({ order: [], hidden: [] })
  })
})

describe('useTableColumnPrefs', () => {
  it('toggles, moves among present columns, persists, and resets', () => {
    const { result, unmount } = renderHook(() => useTableColumnPrefs('fuel', DEFAULTS))

    act(() => result.current.toggle('mileage'))
    expect(result.current.hidden).toEqual(['mileage'])

    // `propane` is absent for this vehicle, so `cost` moves past it to swap with `volume`.
    act(() => result.current.move('cost', -1, ['date', 'mileage', 'volume', 'cost']))
    expect(result.current.order).toEqual(['date', 'mileage', 'cost', 'propane', 'volume'])

    unmount()
    const again = renderHook(() => useTableColumnPrefs('fuel', DEFAULTS))
    expect(again.result.current.hidden).toEqual(['mileage'])
    expect(again.result.current.order).toEqual(['date', 'mileage', 'cost', 'propane', 'volume'])

    act(() => again.result.current.reset())
    expect(again.result.current.order).toEqual(DEFAULTS)
    expect(again.result.current.hidden).toEqual([])
    expect(localStorage.getItem('table_columns:fuel')).toBeNull()
  })

  it('ignores a move past either end', () => {
    const { result } = renderHook(() => useTableColumnPrefs('fuel', DEFAULTS))
    act(() => result.current.move('date', -1, DEFAULTS))
    expect(result.current.order).toEqual(DEFAULTS)
    expect(localStorage.getItem('table_columns:fuel')).toBeNull()
  })
})
