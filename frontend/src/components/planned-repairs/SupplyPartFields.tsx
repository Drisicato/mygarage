/**
 * Pick a supply and how much of it, for a planned repair's part or the line
 * item its completion logs. Quantities are typed in the supply's own display
 * unit (mL, L, qt, a count...); the caller converts to canonical on submit
 * with the same unit, via `rowUnit`.
 */

import { useTranslation } from 'react-i18next'
import { NumberInput, Select } from '../ui'
import { useCurrencyPreference } from '../../hooks/useCurrencyPreference'
import { displayDecimals, toCanonical, toDisplay, unitLabel, type SupplyUnit } from '../../utils/supplyUnits'
import { parseOptionalDecimal } from '../../utils/decimalInput'
import type { Supply } from '../../types/supplies'

/** What a supply row's estimate costs, at the supply's average price per canonical unit. */
export function supplyEstimate(supply: Supply | undefined, quantityCanonical: number): number {
  if (!supply?.avg_unit_cost || !quantityCanonical) return 0
  return Number(supply.avg_unit_cost) * quantityCanonical
}

interface SupplyPartFieldsProps {
  /** Every supply (active and archived), so a linked archived one still shows its name. */
  supplies: Supply[]
  vin: string
  supplyId: number
  /** The unit the quantity is typed in; the same one the caller submits with. */
  unit: SupplyUnit
  /** Display units, as typed. */
  quantity: string
  onChange: (change: { supplyId?: number; quantity?: string }) => void
  index: number
  invalid?: boolean
  disabled?: boolean
}

export default function SupplyPartFields({
  supplies,
  vin,
  supplyId,
  unit,
  quantity,
  onChange,
  index,
  invalid,
  disabled,
}: SupplyPartFieldsProps) {
  const { t } = useTranslation('vehicles')
  const { formatCurrency } = useCurrencyPreference()

  const supply = supplies.find((s) => s.id === supplyId)
  // Offer what this vehicle can use: active, and shared or pinned to it. The
  // row's own supply stays listed even if it was archived since.
  const options = supplies.filter(
    (s) => s.id === supplyId || (s.is_active && (s.vin == null || s.vin === vin)),
  )
  const label = unitLabel(unit)
  const onHand = supply ? toDisplay(Number(supply.on_hand), unit) : 0
  const typed = parseOptionalDecimal(quantity) ?? 0
  const estimate = supplyEstimate(supply, toCanonical(typed, unit))
  const short = !!supply && typed > onHand

  return (
    <div className="flex-1 min-w-0 space-y-1">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <Select
            aria-label={t('plannedRepairs.supply', { number: index + 1 })}
            value={String(supplyId)}
            onChange={(e) => onChange({ supplyId: Number(e.target.value) })}
            disabled={disabled}
            options={[
              ...(supply == null ? [{ value: String(supplyId), label: `#${supplyId}` }] : []),
              ...options.map((s) => ({ value: String(s.id), label: s.name })),
            ]}
          />
        </div>
        <div className="w-32 flex items-center gap-1">
          <NumberInput
            aria-label={t('plannedRepairs.supplyQuantity', { number: index + 1 })}
            value={quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
            invalid={invalid}
            disabled={disabled}
          />
          {label && <span className="text-xs text-text-mute flex-shrink-0">{label}</span>}
        </div>
      </div>
      {supply && (
        <p className={`text-xs ${short ? 'text-warning' : 'text-text-mute'}`}>
          {t('plannedRepairs.onHand', { amount: `${onHand.toFixed(displayDecimals(unit))} ${label}`.trim() })}
          {estimate > 0 && ` · ${t('plannedRepairs.supplyEstimate', { cost: formatCurrency(estimate) })}`}
          {short && ` · ${t('plannedRepairs.notEnoughOnHand')}`}
        </p>
      )}
    </div>
  )
}
