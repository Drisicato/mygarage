import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle, MinusCircle, XCircle } from 'lucide-react'
import type { InspectionPointStatus } from '../../types/vehicleInspection'
import { INSPECTION_STATUSES } from '../../types/vehicleInspection'

/** Pressed styling per status, in the fixed status tones (they never follow the accent). */
const STATUS_STYLE: Record<InspectionPointStatus, { icon: typeof CheckCircle; pressed: string }> = {
  green: { icon: CheckCircle, pressed: 'bg-success/15 border-success text-success' },
  yellow: { icon: AlertTriangle, pressed: 'bg-warning/15 border-warning text-warning' },
  red: { icon: XCircle, pressed: 'bg-danger/15 border-danger text-danger' },
  not_inspected: { icon: MinusCircle, pressed: 'bg-surface-3 border-text-mute text-text-dim' },
}

interface InspectionStatusPickerProps {
  value: InspectionPointStatus
  onChange: (status: InspectionPointStatus) => void
  /** What is being rated, for the group's accessible name. */
  label: string
  disabled?: boolean
  /** Icon-only buttons, for dense rows. The status name stays as the accessible name. */
  compact?: boolean
}

/** Four toggle buttons: OK, future attention, immediate attention, not inspected. */
export default function InspectionStatusPicker({
  value,
  onChange,
  label,
  disabled = false,
  compact = false,
}: InspectionStatusPickerProps) {
  const { t } = useTranslation('vehicles')
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {INSPECTION_STATUSES.map((status) => {
        const { icon: Icon, pressed } = STATUS_STYLE[status]
        const selected = value === status
        const name = t(`vehicleInspections.status.${status}`)
        return (
          <button
            key={status}
            type="button"
            aria-pressed={selected}
            aria-label={compact ? name : undefined}
            title={compact ? name : undefined}
            onClick={() => onChange(status)}
            disabled={disabled}
            className={`inline-flex items-center gap-1 rounded-chip border px-2 py-1 text-xs font-medium ui-focus-ring ui-motion ${
              selected
                ? pressed
                : 'border-border-soft text-text-mute hover:border-text-mute hover:text-text'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Icon aria-hidden="true" className="h-3.5 w-3.5" />
            {!compact && <span>{name}</span>}
          </button>
        )
      })}
    </div>
  )
}
