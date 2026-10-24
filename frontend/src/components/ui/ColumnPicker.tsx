import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Columns3 } from 'lucide-react'
import Button from './Button'
import Checkbox from './Checkbox'
import IconButton from './IconButton'

export interface ColumnPickerColumn {
  id: string
  /** Already translated by the caller. */
  header: string
}

interface ColumnPickerProps {
  /** Trigger text and the panel's accessible name. Already translated. */
  label: string
  /** Every column the user may show or hide, in the table's current order. */
  columns: ColumnPickerColumn[]
  hidden: string[]
  onToggle: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  onReset: () => void
  resetLabel: string
  moveUpLabel: (header: string) => string
  moveDownLabel: (header: string) => string
}

/**
 * Show, hide and reorder a DataTable's columns.
 *
 * Same catcher and panel layers as Dropdown (z-dropdown-catcher under
 * z-dropdown), and the same close paths (Escape, outside click) handing focus
 * back to the trigger. Not a Dropdown: that is a single-select menu that
 * closes on every pick, and this panel stays open while several columns are
 * toggled and moved. Up/down buttons rather than drag, so reordering works
 * from the keyboard.
 *
 * The last visible column's checkbox is disabled: a table with no columns
 * would have nothing left to switch them back on from but this panel, and
 * reads as broken.
 */
export default function ColumnPicker({
  label,
  columns,
  hidden,
  onToggle,
  onMove,
  onReset,
  resetLabel,
  moveUpLabel,
  moveDownLabel,
}: ColumnPickerProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  const close = useCallback((): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  const visibleCount = columns.filter((c) => !hidden.includes(c.id)).length

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className="ui-focus-ring ui-motion ui-hover-surface inline-flex h-btn-md cursor-pointer items-center gap-2 rounded-control border border-border bg-surface-2 px-4 text-sm text-text"
      >
        <Columns3 aria-hidden="true" className="h-4 w-4" />
        {label}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-dropdown-catcher" onClick={close} aria-hidden="true" />
          <div
            id={panelId}
            role="dialog"
            aria-label={label}
            className="absolute right-0 z-dropdown mt-2 min-w-64 rounded-panel border border-border bg-surface p-2 shadow-menu"
          >
            <ul className="space-y-1">
              {columns.map((column, i) => {
                const isHidden = hidden.includes(column.id)
                return (
                  <li key={column.id} className="flex items-center gap-2 rounded-row px-2 py-1 hover:bg-surface-2">
                    <div className="flex-1">
                      <Checkbox
                        label={column.header}
                        checked={!isHidden}
                        disabled={!isHidden && visibleCount <= 1}
                        onChange={() => onToggle(column.id)}
                      />
                    </div>
                    <IconButton
                      icon={ChevronUp}
                      label={moveUpLabel(column.header)}
                      variant="ghost"
                      size="sm"
                      disabled={i === 0}
                      onClick={() => onMove(column.id, -1)}
                    />
                    <IconButton
                      icon={ChevronDown}
                      label={moveDownLabel(column.header)}
                      variant="ghost"
                      size="sm"
                      disabled={i === columns.length - 1}
                      onClick={() => onMove(column.id, 1)}
                    />
                  </li>
                )
              })}
            </ul>
            <div className="mt-2 border-t border-hair pt-2">
              <Button variant="ghost" size="sm" onClick={onReset}>
                {resetLabel}
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
