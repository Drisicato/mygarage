import { useState } from 'react'
import type { ReactElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import AddressBookAutocomplete from '../AddressBookAutocomplete'
import type { AddressBookEntry } from '../../types/addressBook'

// Timers, fetches and state only, so jsdom covers all of it: nothing here
// depends on layout or stacking.

// vi.mock is hoisted above module-level consts, so the spy has to come from vi.hoisted.
const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../../services/api', () => ({ default: { get } }))

const entry = (id: number, businessName: string): AddressBookEntry => ({
  id,
  business_name: businessName,
  source: 'manual',
  created_at: '2026-10-02T00:00:00Z',
  updated_at: '2026-10-02T00:00:00Z',
})

const SHELL = entry(1, 'Shell')
const SHEETZ = entry(2, 'Sheetz')
const ZZ_GARAGE = entry(3, 'Zz Garage')

type SearchResponse = { data: { entries: AddressBookEntry[] } }
const found = (...entries: AddressBookEntry[]): SearchResponse => ({ data: { entries } })

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface PickerProps {
  initial?: string
  onAddNew?: (typedName: string) => void
  withClear?: boolean
}

// The forms own the value, so the tests do too: a pick has to come back in as a new value.
function Picker({ initial = '', onAddNew, withClear = false }: PickerProps): ReactElement {
  const [value, setValue] = useState(initial)
  return (
    <AddressBookAutocomplete
      id="station"
      value={value}
      onChange={setValue}
      onClear={withClear ? () => setValue('') : undefined}
      onAddNew={onAddNew}
    />
  )
}

// Stands in for FuelRecordForm: + Add opens quick add, and saving it writes the new name into the box.
function PickerWithQuickAdd(): ReactElement {
  const [value, setValue] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  return (
    <>
      <AddressBookAutocomplete id="station" value={value} onChange={setValue} onAddNew={setAdding} />
      {adding !== null && (
        <button
          type="button"
          onClick={() => {
            setValue(`${adding} Garage`)
            setAdding(null)
          }}
        >
          save quick add
        </button>
      )}
    </>
  )
}

const input = (): HTMLInputElement => screen.getByRole<HTMLInputElement>('textbox')
const type = (text: string): void => {
  fireEvent.change(input(), { target: { value: text } })
}
const wait = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
const option = (name: string): HTMLElement | null => screen.queryByRole('button', { name })
const pick = (name: string): void => {
  fireEvent.click(screen.getByRole('button', { name }))
}
const spinner = (container: HTMLElement): Element | null => container.querySelector('.animate-spin')
const clearButton = (): HTMLElement | null =>
  screen.queryByRole('button', { name: 'addressBookAutocomplete.clear' })

beforeEach(() => {
  vi.useFakeTimers()
  get.mockReset()
  get.mockResolvedValue(found(SHELL))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('AddressBookAutocomplete after a pick (#194)', () => {
  it('a pick does not reopen the list', async () => {
    // The pick wrote the value, the value fired a search, and the list popped back ~300 ms later.
    render(<Picker />)
    type('Sh')
    await wait(300)
    pick('Shell')
    await wait(1000)
    expect(input().value).toBe('Shell')
    expect(get).toHaveBeenCalledTimes(1)
    expect(option('Shell')).not.toBeInTheDocument()
  })

  it('typing after a pick searches again', async () => {
    // Guard, passes before the fix: the fix mustn't swallow real typing. Killed by the mutant that
    // remembers the picked name and skips any search equal to it, never forgetting it.
    render(<Picker />)
    type('Sh')
    await wait(300)
    pick('Shell')
    type('Shel')
    type('Shell')
    await wait(300)
    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenLastCalledWith(expect.stringContaining('search=Shell'))
    expect(option('Shell')).toBeInTheDocument()
  })

  it.each([
    { label: 'the pick changes the text', typed: ['Sh', 'She'] },
    { label: 'the picked name is already the text', typed: ['Shel', 'Shell'] },
  ])('a search still in flight when you pick does not reopen the list ($label)', async ({ typed }) => {
    // The late answer used to land after the pick and open the list over it.
    const late = deferred<SearchResponse>()
    render(<Picker />)
    type(typed[0])
    await wait(300)
    get.mockReturnValueOnce(late.promise)
    type(typed[1])
    await wait(300)
    expect(get).toHaveBeenCalledTimes(2)
    pick('Shell')
    await act(async () => {
      late.resolve(found(SHEETZ))
    })
    expect(option('Sheetz')).not.toBeInTheDocument()
    expect(option('Shell')).not.toBeInTheDocument()
    // Focus reopens the list from the entries it holds, which is the only way to see them.
    fireEvent.focus(input())
    expect(option('Shell')).toBeInTheDocument()
    expect(option('Sheetz')).not.toBeInTheDocument()
  })

  it('a pick made before the next search starts does not reopen the list', async () => {
    // The pick names what's already typed, so the value doesn't change and the waiting search
    // still fires afterwards. Checking the typed text only when the effect runs misses this.
    render(<Picker />)
    type('Shel')
    await wait(300)
    type('Shell')
    pick('Shell')
    await wait(1000)
    expect(get).toHaveBeenCalledTimes(1)
    expect(option('Shell')).not.toBeInTheDocument()
  })

  it('a late failure after a pick leaves the picker idle', async () => {
    // A dropped search skips its own finally, so the pick has to stop the spinner itself.
    const errors = vi.spyOn(console, 'error')
    const late = deferred<SearchResponse>()
    const { container } = render(<Picker withClear />)
    type('Sh')
    await wait(300)
    get.mockReturnValueOnce(late.promise)
    type('She')
    await wait(300)
    expect(spinner(container)).toBeInTheDocument()
    pick('Shell')
    expect(spinner(container)).not.toBeInTheDocument()
    expect(clearButton()).toBeInTheDocument()
    await act(async () => {
      late.reject(new Error('network down'))
    })
    expect(spinner(container)).not.toBeInTheDocument()
    expect(clearButton()).toBeInTheDocument()
    expect(option('Shell')).not.toBeInTheDocument()
    expect(errors).not.toHaveBeenCalled()
  })

  it('backspacing under two characters mid-search stops the spinner', async () => {
    // Under two characters drops the running search, so its spinner and its late answer go too.
    const late = deferred<SearchResponse>()
    const { container } = render(<Picker />)
    type('Sh')
    await wait(300)
    get.mockReturnValueOnce(late.promise)
    type('She')
    await wait(300)
    expect(spinner(container)).toBeInTheDocument()
    type('S')
    await wait(300)
    expect(spinner(container)).not.toBeInTheDocument()
    await act(async () => {
      late.resolve(found(SHEETZ))
    })
    expect(spinner(container)).not.toBeInTheDocument()
    expect(option('Sheetz')).not.toBeInTheDocument()
    expect(option('Shell')).not.toBeInTheDocument()
  })

  it('opening an edit form with a saved station does not open the list', async () => {
    // The seeded name used to be searched like typing, so the list opened by itself.
    render(<Picker initial="Shell X" />)
    await wait(1000)
    expect(get).not.toHaveBeenCalled()
    expect(option('Shell')).not.toBeInTheDocument()
  })

  it('a station returned by quick add does not reopen the list', async () => {
    // Nothing matches the typed text, so + Add shows; once added, the new name would match.
    get.mockResolvedValue(found(ZZ_GARAGE))
    get.mockResolvedValueOnce(found())
    render(<PickerWithQuickAdd />)
    type('Zz')
    await wait(300)
    fireEvent.click(screen.getByRole('button', { name: 'addressBookAutocomplete.addToAddressBook' }))
    fireEvent.click(screen.getByRole('button', { name: 'save quick add' }))
    expect(input().value).toBe('Zz Garage')
    await wait(1000)
    expect(get).toHaveBeenCalledTimes(1)
    expect(option('Zz Garage')).not.toBeInTheDocument()
  })

  it('a new onAddNew each render does not refetch', async () => {
    // Callers pass an inline function, and a new one each render used to refire the search.
    const { rerender } = render(<Picker onAddNew={vi.fn()} />)
    type('Sh')
    await wait(300)
    expect(get).toHaveBeenCalledTimes(1)
    rerender(<Picker onAddNew={vi.fn()} />)
    await wait(1000)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('the clear button closes an open list', async () => {
    // Guard, passes before the fix: clearing empties the value from the parent, which nobody typed.
    // Killed by the mutant that runs the typed-only return before the short-value branch.
    render(<Picker withClear />)
    type('Sh')
    await wait(300)
    expect(option('Shell')).toBeInTheDocument()
    fireEvent.click(clearButton() as HTMLElement)
    await wait(300)
    expect(input().value).toBe('')
    expect(option('Shell')).not.toBeInTheDocument()
  })
})

describe('AddressBookAutocomplete after a close (#194)', () => {
  it.each([
    { label: 'Escape', close: (): void => void fireEvent.keyDown(input(), { key: 'Escape' }) },
    { label: 'a click outside', close: (): void => void fireEvent.mouseDown(document.body) },
  ])('closing the list drops its pending search ($label)', async ({ close }) => {
    // Closing only hid the list: the search still waiting fired anyway and the
    // late answer landed, and either one opened it again.
    const late = deferred<SearchResponse>()
    const { container } = render(<Picker />)
    type('Sh')
    await wait(300)
    get.mockReturnValueOnce(late.promise)
    type('She')
    await wait(300)
    type('Shel')
    expect(option('Shell')).toBeInTheDocument()
    close()
    expect(option('Shell')).not.toBeInTheDocument()
    expect(spinner(container)).not.toBeInTheDocument()
    await wait(300)
    await act(async () => {
      late.resolve(found(SHEETZ))
    })
    expect(get).toHaveBeenCalledTimes(2)
    expect(option('Shell')).not.toBeInTheDocument()
    expect(option('Sheetz')).not.toBeInTheDocument()
  })

  it('typing again after Escape opens the list', async () => {
    // Guard, passes before the fix: a close mustn't stop searching for good. Killed by the
    // mutant where Escape sets a closed flag the search checks and typing never clears.
    render(<Picker />)
    type('Sh')
    await wait(300)
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(option('Shell')).not.toBeInTheDocument()
    type('She')
    await wait(300)
    expect(get).toHaveBeenCalledTimes(2)
    expect(option('Shell')).toBeInTheDocument()
  })
})
