/**
 * A card that is one click target AND keeps its own text selectable, without
 * stealing the clicks of anything inside it.
 *
 * ★ WHY THIS IS A COMPONENT AND NOT TWO PROPS AT EACH CALL SITE. It replaces
 * `CardEditOverlay`, a transparent full-card `<button className="absolute
 * inset-0 z-10">` whose own docstring said it "sits above everything". It did:
 * nothing underneath could be long-pressed, so on a phone the VIN could not be
 * selected and the selection handles would not drag (issue #179). The fix needs
 * a container handler AND a keyboard control AND a selection guard AND a
 * nested-control rule, on the vehicle info cards (through EditableCard), the
 * tire cards and the address book cards. Wiring four things by hand at every
 * call site is how one card ends up with three of them, so the pattern lives
 * here instead.
 *
 * The four pieces:
 *
 * 1. The click handler is on the CARD, not on anything stacked over its
 *    content. Nothing is above the text, so a long-press reaches the text.
 * 2. A click that merely ENDS a text selection does not activate the card.
 *    Without this, selecting the VIN would open an editor every time you let
 *    go, which trades one annoyance for a worse one.
 * 3. A named button, visually hidden until focused, keeps the action reachable
 *    for keyboard and screen-reader users, who cannot use a container's click
 *    handler at all.
 * 4. A control inside the card owns its click. A link, button or input nested
 *    in the card does its own thing and the card stays out of it, which is why
 *    the tire and contact cards' buttons and links need no `stopPropagation`.
 */

import type { ReactElement, ReactNode } from 'react'
import { Card } from './ui'
import { isSelectingText } from '../utils/textSelection'

/** Positioning context plus the hover/focus cues of a clickable card. */
export const CLICKABLE_CARD_CLASS =
  'relative cursor-pointer ui-motion ui-hover-line hover:shadow-card-hover'

/** Anything a person clicks on purpose inside a card. Its own click is its own. */
const NESTED_CONTROL =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="checkbox"]'

/** Whether a click on the card actually started in a control nested inside it. */
export function cameFromNestedControl(event: React.MouseEvent<HTMLElement>): boolean {
  // React clicks bubble through portals, so a dialog rendered as a child of the
  // card lands here with a target outside it. That click belongs to the dialog.
  if (event.target instanceof Node && !event.currentTarget.contains(event.target)) return true
  const target = event.target instanceof Element ? event.target : null
  const control = target?.closest(NESTED_CONTROL)
  return control !== null && control !== undefined && control !== event.currentTarget && event.currentTarget.contains(control)
}

interface ClickableCardProps {
  /** Accessible name for the card's action, already translated. */
  label: string
  /** What a click on the card (or its hidden button) does. */
  onActivate: () => void
  /** Passed straight to Card; Card's own default when omitted. */
  padding?: 'none' | 'sm' | 'md'
  /** For masonry/column layouts that must not split a card. */
  breakInside?: boolean
  className?: string
  children: ReactNode
}

/**
 * One click target over a whole card, with its text still selectable and its
 * nested controls left alone. See the four pieces above.
 */
export default function ClickableCard({
  label,
  onActivate,
  padding,
  breakInside = false,
  className = '',
  children,
}: ClickableCardProps): ReactElement {
  return (
    <Card
      padding={padding}
      breakInside={breakInside}
      className={[CLICKABLE_CARD_CLASS, className].filter(Boolean).join(' ')}
      onClick={(event) => {
        if (cameFromNestedControl(event) || isSelectingText()) return
        onActivate()
      }}
    >
      {/* ★ THE STYLING IS ON THE WRAPPER AND THE VISIBILITY IS ON THE BUTTON, on
          purpose. Tailwind's `not-sr-only` resets position, padding AND margin,
          so any `focus:absolute` / `focus:px-2` sitting beside it on the same
          element is in a fight it wins or loses purely on the order the two
          utilities happen to be emitted in. Keeping the button to nothing but
          `sr-only` / `focus:not-sr-only`, and hanging the position and the chip
          styling off the wrapper's `focus-within`, leaves nothing to conflict.
          `pointer-events-none` because the focused chip sits over the card's
          top-right controls and took their clicks. It's a keyboard cue only;
          Enter and Space don't hit-test, so they still reach the button. */}
      <span className="pointer-events-none absolute right-2 top-2 z-10 rounded-lg focus-within:bg-surface-2 focus-within:px-2 focus-within:py-1 focus-within:text-xs">
        <button
          type="button"
          onClick={(event) => {
            // Belt and braces. The card already ignores a click that started
            // in a nested control, this button included, so it won't fire twice.
            event.stopPropagation()
            onActivate()
          }}
          className="ui-focus-ring sr-only focus:not-sr-only"
        >
          {label}
        </button>
      </span>
      {children}
    </Card>
  )
}
