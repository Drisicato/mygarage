/**
 * ClickableCard: one click target that keeps its own text selectable and
 * leaves the controls inside it alone (issues #179, #194).
 *
 * jsdom has no layout and no long-press, so these pin STRUCTURE and HANDLERS:
 * the handler sits on the card, nothing is stretched over the content, a click
 * that ends a selection or starts in a nested control is ignored. Whether the
 * text is actually on top in a real browser is the E2E task's half.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import ClickableCard, { cameFromNestedControl } from '../ClickableCard'

const LABEL = 'Open tire history'

function renderCard(children: ReactNode = <p>DOT 4521</p>): {
  onActivate: ReturnType<typeof vi.fn>
  card: HTMLElement
} {
  const onActivate = vi.fn()
  const { container } = render(
    <ClickableCard label={LABEL} onActivate={onActivate}>
      {children}
    </ClickableCard>,
  )
  return { onActivate, card: container.firstElementChild as HTMLElement }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ClickableCard', () => {
  it("a click on the card's text activates it", () => {
    // Guard at t=0: this is EditableCard's behaviour, moved. Mutant that kills
    // it: drop the card's onClick.
    const { onActivate } = renderCard()

    fireEvent.click(screen.getByText('DOT 4521'))

    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('a click that ends a text selection does not activate', () => {
    // Guard at t=0, moved from EditableCard. Mutant that kills it: skip
    // isSelectingText in the card's handler.
    const { onActivate } = renderCard()
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      toString: () => 'DOT 4521',
    } as unknown as Selection)

    fireEvent.click(screen.getByText('DOT 4521'))

    expect(onActivate).not.toHaveBeenCalled()
  })

  it('a click on a nested link, button or input does not activate', () => {
    // RED against a ClickableCard written like today's EditableCard: every one
    // of these clicks bubbled to the card and opened it as well.
    const onNestedButton = vi.fn()
    const { onActivate } = renderCard(
      <>
        <a href="#x">Mounted on Ram</a>
        <button type="button" onClick={onNestedButton}>
          Log reading
        </button>
        <input aria-label="Tread depth" />
        <span role="button" tabIndex={0}>
          Retire
        </span>
      </>,
    )

    fireEvent.click(screen.getByRole('link', { name: 'Mounted on Ram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Log reading' }))
    fireEvent.click(screen.getByRole('textbox', { name: 'Tread depth' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retire' }))

    // The control still gets its own click; the card just stays out of it.
    expect(onNestedButton).toHaveBeenCalledTimes(1)
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('the hidden button activates once', () => {
    // Guard: the keyboard route, moved from EditableCard. Mutant that kills
    // it: the hidden button's onClick does nothing (0 calls). Dropping its
    // stopPropagation SURVIVES, because the card already ignores a click that
    // started in a nested control, so that call is belt and braces only.
    const { onActivate } = renderCard()

    fireEvent.click(screen.getByRole('button', { name: LABEL }))

    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('nothing absolutely positioned covers the content', () => {
    // Structural guard for the #179 cause: an `absolute inset-0` control (or a
    // stretched `after:inset-0` pseudo-element) sits above the text and eats the
    // long-press. Mutant that kills it: give the hidden button the old
    // CardEditOverlay shape, `absolute inset-0 z-10`. The focus chip's wrapper
    // is the one positioned element allowed, and it is pinned to a corner.
    const { card } = renderCard()
    const chipWrapper = screen.getByRole('button', { name: LABEL }).parentElement as HTMLElement

    const everything = [card, ...Array.from(card.querySelectorAll<HTMLElement>('*'))]
    const tokensOf = (el: Element): string[] => (el.getAttribute('class') ?? '').split(/\s+/)

    const stretched = everything.filter((el) =>
      tokensOf(el).some((token) => token === 'inset-0' || token.endsWith(':inset-0')),
    )
    expect(stretched).toEqual([])

    const positioned = everything.filter((el) => tokensOf(el).includes('absolute'))
    expect(positioned).toEqual([chipWrapper])
    expect(chipWrapper).toHaveClass('right-2', 'top-2')
  })

  it('a card sitting inside a link still activates on its own text', () => {
    // Guard for the `currentTarget.contains(control)` half of
    // cameFromNestedControl: closest() walks past the card, so a control
    // AROUND the card is not one nested in it. Mutant that kills it: drop the
    // contains() check.
    const onActivate = vi.fn()
    render(
      <a href="#outer">
        <ClickableCard label={LABEL} onActivate={onActivate}>
          <p>DOT 4521</p>
        </ClickableCard>
      </a>,
    )

    fireEvent.click(screen.getByText('DOT 4521'))

    expect(onActivate).toHaveBeenCalledTimes(1)
  })
})

describe('cameFromNestedControl', () => {
  it('a container that is itself a control does not count as nested in itself', () => {
    // Guard for the `control !== currentTarget` half: a card that carries its
    // own role="button" must not read a click on its own text as a nested
    // control's. Mutant that kills it: drop the currentTarget comparison.
    const seen: boolean[] = []
    render(
      <div
        role="button"
        tabIndex={0}
        onClick={(event) => seen.push(cameFromNestedControl(event))}
      >
        <span>Oil change due</span>
        <a href="#y">Shop</a>
      </div>,
    )

    fireEvent.click(screen.getByText('Oil change due'))
    fireEvent.click(screen.getByRole('link', { name: 'Shop' }))

    expect(seen).toEqual([false, true])
  })
})
