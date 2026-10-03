/**
 * An info card that is one click-to-edit target AND keeps its own text
 * selectable.
 *
 * The pattern itself (the card's handler, the selection guard, the hidden
 * keyboard button and the nested-control rule) lives in ClickableCard, which
 * the tire and address book cards share. This just keeps the vehicle cards'
 * props and falls back to a plain Card when there's nothing to edit.
 */

import type { ReactElement, ReactNode } from 'react'
import { Card } from '../ui'
import ClickableCard, { CLICKABLE_CARD_CLASS } from '../ClickableCard'

/** Old name for CLICKABLE_CARD_CLASS, kept so no importer has to change. */
export const EDITABLE_CARD_CLASS = CLICKABLE_CARD_CLASS

interface EditableCardProps {
  /** Accessible name for the edit action, already translated. */
  label: string
  /** Opens the editor. Omit to render an ordinary, non-editable card. */
  onEdit?: () => void
  /** For masonry/column layouts that must not split a card. */
  breakInside?: boolean
  className?: string
  children: ReactNode
}

/** A vehicle info card: click-to-edit when `onEdit` is set, plain otherwise. */
export default function EditableCard({
  label,
  onEdit,
  breakInside = false,
  className = '',
  children,
}: EditableCardProps): ReactElement {
  if (!onEdit) {
    return (
      <Card breakInside={breakInside} className={className}>
        {children}
      </Card>
    )
  }

  return (
    <ClickableCard label={label} onActivate={onEdit} breakInside={breakInside} className={className}>
      {children}
    </ClickableCard>
  )
}
