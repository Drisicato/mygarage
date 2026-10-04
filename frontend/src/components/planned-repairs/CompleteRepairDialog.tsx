/**
 * Finish a planned repair: confirm what was actually done and paid, and log
 * it as a service visit. Pre-filled from the repair (its parts become the
 * line items, or its title and estimate when it has none) so the common case
 * is one click, but every amount stays editable for the real invoice.
 */

import { useMemo, useState, type SyntheticEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Package, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import FormModalWrapper from '../FormModalWrapper'
import VendorSearch from '../VendorSearch'
import SupplyPartFields, { supplyEstimate } from './SupplyPartFields'
import { useSupplies } from '../../hooks/queries/useSupplies'
import { useUnitPreference } from '../../hooks/useUnitPreference'
import { supplyDisplayUnit, toCanonical, toDisplay, type SupplyUnit } from '../../utils/supplyUnits'
import { Button, Field, IconButton, Input, NumberInput, Select, Textarea } from '../ui'
import { useCompletePlannedRepair } from '../../hooks/queries/usePlannedRepairs'
import { useUnitFormat } from '../../hooks/useUnitFormat'
import { useCurrencyPreference } from '../../hooks/useCurrencyPreference'
import { canonicalFromUnitField, seedUnitField, type UnitFieldOrigin } from '../../utils/unitFormat'
import { formatDateForInput } from '../../utils/dateUtils'
import { parseOptionalDecimal } from '../../utils/decimalInput'
import { getActionErrorMessage } from '../../utils/httpErrorHandler'
import { moneyTextError } from '../../schemas/shared'
import { SERVICE_CATEGORIES } from '../../schemas/serviceVisit'
import type { PlannedRepair } from '../../types/plannedRepair'
import type { ServiceVisitCreate } from '../../types/serviceVisit'

interface ItemRow {
  key: number
  description: string
  cost: string
  /** Set when the item consumes a supply; `quantity` is then in display units. */
  supplyId: number | null
  quantity: string
  /** The unit `quantity` is typed in, kept with the row so submit converts with it. */
  unit: SupplyUnit
}

interface CompleteRepairDialogProps {
  vin: string
  repair: PlannedRepair
  currentMileage?: number | null
  currentHours?: number | null
  tracksDistance: boolean
  tracksHours: boolean
  onClose: () => void
  onSuccess: () => void
}

const costText = (value: string | number | null | undefined) =>
  value === null || value === undefined ? '' : String(Number(value))

export default function CompleteRepairDialog({
  vin,
  repair,
  currentMileage,
  currentHours,
  tracksDistance,
  tracksHours,
  onClose,
  onSuccess,
}: CompleteRepairDialogProps) {
  const { t } = useTranslation('vehicles')
  const u = useUnitFormat()
  const { currencyCode, formatCurrency } = useCurrencyPreference()
  const completeMutation = useCompletePlannedRepair(vin)
  const submitting = completeMutation.isPending

  const [date, setDate] = useState(formatDateForInput())
  const [odometerOrigin] = useState<UnitFieldOrigin>(() => seedUnitField(currentMileage ?? null, u.distance))
  const [odometerText, setOdometerText] = useState(odometerOrigin.display)
  const [hoursText, setHoursText] = useState(currentHours != null ? String(currentHours) : '')
  const [vendorId, setVendorId] = useState<number | undefined>(repair.vendor_id ?? undefined)
  const [category, setCategory] = useState<string>(repair.service_category ?? 'Maintenance')
  const { system } = useUnitPreference()
  const { data: supplyData } = useSupplies(true)
  const supplies = useMemo(() => supplyData?.supplies ?? [], [supplyData])
  const addableSupplies = supplies.filter((s) => s.is_active && (s.vin == null || s.vin === vin))
  // The parts become the line items (supplies keep their planned quantity), or
  // the repair's title and estimate when it has no parts.
  const [items, setItems] = useState<ItemRow[]>(() => {
    const parts = repair.parts ?? []
    if (parts.length === 0) {
      return [{ key: -1, description: repair.title, cost: costText(repair.estimated_cost), supplyId: null, quantity: '', unit: 'count' }]
    }
    return parts.map((p): ItemRow => {
      // The part carries its supply's unit, so the quantity converts
      // correctly before the supplies list has loaded.
      const unit = supplyDisplayUnit(
        { unit_type: p.unit_type ?? 'count', volume_unit: p.volume_unit ?? null },
        system,
      )
      return {
        key: p.id,
        description: p.description,
        cost: costText(p.cost),
        supplyId: p.supply_id ?? null,
        quantity: p.supply_quantity != null ? String(+toDisplay(Number(p.supply_quantity), unit).toFixed(3)) : '',
        unit,
      }
    })
  })
  const [nextKey, setNextKey] = useState(-2)
  const [taxText, setTaxText] = useState('')
  const [notes, setNotes] = useState(repair.description ?? '')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const supplyById = (id: number | null) => supplies.find((s) => s.id === id)
  /** A supply item's quantity in canonical units (L or count), as the API takes it. */
  const canonicalQuantity = (item: ItemRow) =>
    +toCanonical(parseOptionalDecimal(item.quantity) ?? 0, item.unit).toFixed(3)
  /** The unit a supply's quantity is typed in: its own display unit. */
  const unitFor = (supplyId: number | null): SupplyUnit => {
    const supply = supplyById(supplyId)
    return supply ? supplyDisplayUnit(supply, system) : 'count'
  }
  const total =
    items.reduce(
      (sum, item) =>
        sum +
        (item.supplyId != null
          ? supplyEstimate(supplyById(item.supplyId), canonicalQuantity(item))
          : (parseOptionalDecimal(item.cost) ?? 0)),
      0,
    ) + (parseOptionalDecimal(taxText) ?? 0)

  const updateItem = (key: number, change: Partial<ItemRow>) => {
    setItems((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)))
  }

  const addItem = (supplyId: number | null) => {
    setItems((rows) => [...rows, { key: nextKey, description: '', cost: '', supplyId, quantity: '', unit: unitFor(supplyId) }])
    setNextKey((k) => k - 1)
  }

  const validate = (): boolean => {
    const errors: Record<string, string> = {}
    if (!date) errors.date = t('plannedRepairs.complete.dateRequired')
    const filled = items.filter((item) => item.supplyId != null || item.description.trim())
    if (filled.length === 0) errors.items = t('plannedRepairs.complete.itemRequired')
    items.forEach((item) => {
      if (item.supplyId != null) {
        if (!(canonicalQuantity(item) > 0)) errors[`item-${item.key}`] = t('plannedRepairs.supplyQuantityRequired')
        return
      }
      const costError = moneyTextError(t, item.cost)
      if (costError) errors[`item-${item.key}`] = costError
    })
    const taxError = moneyTextError(t, taxText)
    if (taxError) errors.tax = taxError
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    if (!validate()) return

    const serviceCategory = (category || null) as ServiceVisitCreate['service_category']
    const visit: ServiceVisitCreate = {
      date,
      odometer_km: tracksDistance
        ? canonicalFromUnitField(odometerText, odometerOrigin, u.distance) ?? undefined
        : undefined,
      engine_hours: tracksHours ? parseOptionalDecimal(hoursText) : undefined,
      vendor_id: vendorId ?? null,
      service_category: serviceCategory,
      tax_amount: parseOptionalDecimal(taxText) ?? null,
      notes: notes.trim() || null,
      line_items: items
        .filter((item) => item.supplyId != null || item.description.trim())
        .map((item) =>
          item.supplyId != null
            ? {
                // Consumed from inventory: the usage carries its own cost
                // snapshot, so the line item adds none on top.
                description: (supplyById(item.supplyId)?.name ?? item.description).slice(0, 200),
                category: serviceCategory,
                cost: null,
                is_inspection: false,
                supplies_used: [{ supply_id: item.supplyId, quantity: canonicalQuantity(item) }],
              }
            : {
                description: item.description.trim().slice(0, 200),
                category: serviceCategory,
                cost: parseOptionalDecimal(item.cost) ?? null,
                is_inspection: false,
              },
        ),
    }

    try {
      await completeMutation.mutateAsync({ id: repair.id, visit })
      toast.success(t('plannedRepairs.complete.done'))
      onSuccess()
    } catch (err) {
      setError(getActionErrorMessage(err, t('plannedRepairs.complete.action')))
    }
  }

  return (
    <FormModalWrapper
      title={t('plannedRepairs.complete.title', { title: repair.title })}
      icon={CheckCircle2}
      onClose={onClose}
      width="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" form="complete-repair-form" loading={submitting} disabled={submitting}>
            {t('plannedRepairs.complete.confirm')}
          </Button>
        </>
      }
    >
      <form id="complete-repair-form" onSubmit={handleSubmit} className="p-6 space-y-4">
        {error && (
          <p role="alert" className="text-sm text-danger bg-danger/10 border border-danger rounded-lg p-3">
            {error}
          </p>
        )}
        <p className="text-xs text-text-mute">{t('plannedRepairs.complete.hint')}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field id="complete-repair-date" label={t('plannedRepairs.complete.date')} required error={fieldErrors.date}>
            <Input
              id="complete-repair-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              invalid={!!fieldErrors.date}
              disabled={submitting}
            />
          </Field>
          <Field id="complete-repair-category" label={t('plannedRepairs.fieldCategory')}>
            <Select
              id="complete-repair-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={submitting}
              options={SERVICE_CATEGORIES.map((c) => ({ value: c, label: c }))}
            />
          </Field>
          {tracksDistance && (
            <Field id="complete-repair-odometer" label={t('plannedRepairs.complete.odometer')} unit={u.distance.label}>
              <NumberInput
                id="complete-repair-odometer"
                value={odometerText}
                onChange={(e) => setOdometerText(e.target.value)}
                disabled={submitting}
              />
            </Field>
          )}
          {tracksHours && (
            <Field id="complete-repair-hours" label={t('plannedRepairs.complete.hours')} unit="hr">
              <NumberInput
                id="complete-repair-hours"
                value={hoursText}
                onChange={(e) => setHoursText(e.target.value)}
                disabled={submitting}
              />
            </Field>
          )}
        </div>

        <Field id="complete-repair-vendor" label={t('plannedRepairs.fieldShop')}>
          <VendorSearch value={vendorId} onSelect={(vendor) => setVendorId(vendor?.id)} disabled={submitting} />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-text mb-1">{t('plannedRepairs.complete.items')}</legend>
          {items.map((item, index) => (
            <div key={item.key} className="space-y-1">
              <div className="flex items-start gap-2">
                {item.supplyId != null ? (
                  <SupplyPartFields
                    supplies={supplies}
                    vin={vin}
                    supplyId={item.supplyId}
                    unit={item.unit}
                    quantity={item.quantity}
                    onChange={({ supplyId, quantity }) =>
                      updateItem(item.key, {
                        ...(supplyId !== undefined ? { supplyId, unit: unitFor(supplyId) } : {}),
                        ...(quantity !== undefined ? { quantity } : {}),
                      })
                    }
                    index={index}
                    invalid={!!fieldErrors[`item-${item.key}`]}
                    disabled={submitting}
                  />
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <Input
                        aria-label={t('plannedRepairs.partDescription', { number: index + 1 })}
                        value={item.description}
                        onChange={(e) => updateItem(item.key, { description: e.target.value })}
                        disabled={submitting}
                      />
                    </div>
                    <div className="w-32">
                      <NumberInput
                        aria-label={t('plannedRepairs.partCost', { number: index + 1 })}
                        value={item.cost}
                        onChange={(e) => updateItem(item.key, { cost: e.target.value })}
                        placeholder={currencyCode}
                        invalid={!!fieldErrors[`item-${item.key}`]}
                        disabled={submitting}
                      />
                    </div>
                  </>
                )}
                <IconButton
                  icon={Trash2}
                  label={t('plannedRepairs.removePart')}
                  variant="ghost"
                  size="sm"
                  onClick={() => setItems((rows) => rows.filter((row) => row.key !== item.key))}
                  disabled={submitting || items.length === 1}
                />
              </div>
              {fieldErrors[`item-${item.key}`] && (
                <p className="text-xs text-danger">{fieldErrors[`item-${item.key}`]}</p>
              )}
            </div>
          ))}
          {fieldErrors.items && <p className="text-xs text-danger">{fieldErrors.items}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => addItem(null)} disabled={submitting}>
              {t('plannedRepairs.addPart')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={Package}
              onClick={() => addItem(addableSupplies[0]?.id ?? null)}
              disabled={submitting || addableSupplies.length === 0}
            >
              {t('plannedRepairs.addFromSupplies')}
            </Button>
          </div>
          {items.some((item) => item.supplyId != null) && (
            <p className="text-xs text-text-mute">{t('plannedRepairs.complete.suppliesHint')}</p>
          )}
        </fieldset>

        <Field id="complete-repair-tax" label={t('plannedRepairs.complete.tax')} unit={currencyCode} error={fieldErrors.tax}>
          <NumberInput
            id="complete-repair-tax"
            value={taxText}
            onChange={(e) => setTaxText(e.target.value)}
            invalid={!!fieldErrors.tax}
            disabled={submitting}
          />
        </Field>

        <Field id="complete-repair-notes" label={t('common:notes')}>
          <Textarea
            id="complete-repair-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={submitting}
          />
        </Field>

        <p className="text-sm text-text">
          {t('plannedRepairs.complete.total', { total: formatCurrency(total, { zeroIsValid: true }) })}
        </p>
      </form>
    </FormModalWrapper>
  )
}
