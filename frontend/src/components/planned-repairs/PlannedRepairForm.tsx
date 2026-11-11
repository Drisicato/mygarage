/**
 * Create or edit a planned repair: what it is, how urgent, what it should
 * cost, when and where, and the parts it needs. The parts become the service
 * visit's line items when the repair is completed.
 */

import { useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Package, Plus, Save, Trash2 } from 'lucide-react'
import FormModalWrapper from '../FormModalWrapper'
import VendorSearch from '../VendorSearch'
import SupplyPartFields, { supplyEstimate } from './SupplyPartFields'
import ManualPartFields, { type ManualPartValue } from './ManualPartFields'
import { useVehicle } from '../../hooks/queries/useVehicle'
import { useSupplies } from '../../hooks/queries/useSupplies'
import { useUnitPreference } from '../../hooks/useUnitPreference'
import { supplyDisplayUnit, toCanonical, toEditableDisplay, type SupplyUnit } from '../../utils/supplyUnits'
import { Button, Chip, Field, IconButton, Input, NumberInput, Select, Textarea } from '../ui'
import PlannedRepairPhotoField from './PlannedRepairPhotoField'
import {
  useCreatePlannedRepair,
  useDeletePlannedRepairPhoto,
  useUpdatePlannedRepair,
  useUploadPlannedRepairPhoto,
} from '../../hooks/queries/usePlannedRepairs'
import { MAX_REPAIR_PHOTOS } from '../../utils/plannedRepairPhoto'
import { useFormSubmit } from '../../hooks/useFormSubmit'
import { useUnitFormat } from '../../hooks/useUnitFormat'
import { useCurrencyPreference } from '../../hooks/useCurrencyPreference'
import { canonicalFromUnitField, seedUnitField, type UnitFieldOrigin } from '../../utils/unitFormat'
import { parseOptionalDecimal } from '../../utils/decimalInput'
import { supplyFitsVehicle } from '../../utils/supplyListView'
import { partLineTotal } from '../../utils/plannedRepairParts'
import { isWebUrl } from '../../utils/partSearch'
import { moneyTextError } from '../../schemas/shared'
import { SERVICE_CATEGORIES } from '../../schemas/serviceVisit'
import {
  REPAIR_PRIORITIES,
  VEHICLE_SYSTEMS,
  type PlannedRepair,
  type PlannedRepairCreate,
  type RepairPriority,
  type VehicleSystem,
} from '../../types/plannedRepair'

const TITLE_MAX = 200

interface PartRow extends ManualPartValue {
  key: number
  /** Set when the part comes from supplies; `supplyQuantity` is then in display units. */
  supplyId: number | null
  supplyQuantity: string
  /** The unit `supplyQuantity` is typed in, kept with the row so submit converts with it. */
  unit: SupplyUnit
}

/** What's wrong with one part row, per input. */
type PartErrors = Partial<Record<'supply' | 'description' | 'cost' | 'quantity' | 'url', string>>

const emptyManual: ManualPartValue = { description: '', partNumber: '', cost: '', quantity: '', url: '' }

interface PlannedRepairFormProps {
  vin: string
  repair?: PlannedRepair
  onClose: () => void
  onSuccess: () => void
}

const costText = (value: string | number | null | undefined) =>
  value === null || value === undefined ? '' : String(Number(value))

export default function PlannedRepairForm({ vin, repair, onClose, onSuccess }: PlannedRepairFormProps) {
  const { t } = useTranslation('vehicles')
  const u = useUnitFormat()
  const { currencyCode, formatCurrency } = useCurrencyPreference()
  const isEdit = !!repair
  const createMutation = useCreatePlannedRepair(vin)
  const updateMutation = useUpdatePlannedRepair(vin)
  const uploadPhotoMutation = useUploadPlannedRepairPhoto(vin)
  const deletePhotoMutation = useDeletePlannedRepairPhoto(vin)

  const [title, setTitle] = useState(repair?.title ?? '')
  const [description, setDescription] = useState(repair?.description ?? '')
  const [priority, setPriority] = useState<RepairPriority>(repair?.priority ?? 'medium')
  const [category, setCategory] = useState<string>(repair?.service_category ?? '')
  const [estimate, setEstimate] = useState(costText(repair?.estimated_cost))
  const [targetDate, setTargetDate] = useState(repair?.target_date ?? '')
  const [odometerOrigin] = useState<UnitFieldOrigin>(() =>
    seedUnitField(repair?.target_odometer_km != null ? Number(repair.target_odometer_km) : null, u.distance),
  )
  const [odometerText, setOdometerText] = useState(odometerOrigin.display)
  const [vendorId, setVendorId] = useState<number | undefined>(repair?.vendor_id ?? undefined)
  const [systems, setSystems] = useState<VehicleSystem[]>(repair?.systems ?? [])
  const { data: vehicle } = useVehicle(vin)
  const { system } = useUnitPreference()
  const { data: supplyData } = useSupplies(true)
  const supplies = useMemo(() => supplyData?.supplies ?? [], [supplyData])
  const addableSupplies = supplies.filter((s) => s.is_active && supplyFitsVehicle(s, vin))
  const [parts, setParts] = useState<PartRow[]>(
    () =>
      repair?.parts?.map((p) => {
        // The part carries its supply's unit, so the quantity converts
        // correctly before the supplies list has loaded.
        const unit = supplyDisplayUnit(
          { unit_type: p.unit_type ?? 'count', volume_unit: p.volume_unit ?? null },
          system,
        )
        return {
          key: p.id,
          description: p.description,
          partNumber: p.part_number ?? '',
          cost: costText(p.cost),
          quantity: costText(p.quantity),
          url: p.url ?? '',
          supplyId: p.supply_id ?? null,
          supplyQuantity:
            p.supply_quantity != null ? String(toEditableDisplay(Number(p.supply_quantity), unit)) : '',
          unit,
        }
      }) ?? [],
  )
  const [nextKey, setNextKey] = useState(-1)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [partErrors, setPartErrors] = useState<Record<number, PartErrors>>({})
  const savedId = useRef<number | null>(repair?.id ?? null)
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([])
  const [removedPhotoIds, setRemovedPhotoIds] = useState<number[]>([])
  const [photoError, setPhotoError] = useState<string | null>(null)
  const storedPhotos = (repair?.photos ?? []).filter((p) => !removedPhotoIds.includes(p.id))

  const pickPhotos = (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'))
    const rejected = files.find((f) => !f.type.startsWith('image/'))
    const room = MAX_REPAIR_PHOTOS - storedPhotos.length - pendingPhotos.length
    setPhotoError(
      rejected
        ? t('plannedRepairs.photoNotImage', { name: rejected.name })
        : images.length > room
          ? t('plannedRepairs.photoLimit', { max: MAX_REPAIR_PHOTOS })
          : null,
    )
    setPendingPhotos((current) => [...current, ...images.slice(0, Math.max(room, 0))])
  }

  const supplyById = (id: number | null) => supplies.find((s) => s.id === id)
  /** A supply row's quantity in canonical units (L or count), as the API stores it. */
  const canonicalQuantity = (row: PartRow) =>
    +toCanonical(parseOptionalDecimal(row.supplyQuantity) ?? 0, row.unit).toFixed(3)
  /** The unit a supply's quantity is typed in: its own display unit. */
  const unitFor = (supplyId: number | null): SupplyUnit => {
    const supply = supplyById(supplyId)
    return supply ? supplyDisplayUnit(supply, system) : 'count'
  }
  const partsTotal = parts.reduce(
    (sum, p) =>
      sum +
      (p.supplyId != null
        ? supplyEstimate(supplyById(p.supplyId), canonicalQuantity(p))
        : partLineTotal(parseOptionalDecimal(p.cost) ?? null, parseOptionalDecimal(p.quantity) ?? null)),
    0,
  )

  const submitFn = async () => {
    const payload: PlannedRepairCreate = {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      service_category: (category || null) as PlannedRepairCreate['service_category'],
      estimated_cost: parseOptionalDecimal(estimate) ?? null,
      target_date: targetDate || null,
      target_odometer_km: canonicalFromUnitField(odometerText, odometerOrigin, u.distance),
      vendor_id: vendorId ?? null,
      systems,
      parts: parts
        .filter((p) => p.supplyId != null || p.description.trim())
        .map((p) =>
          p.supplyId != null
            ? {
                // The supply's name is the part; its cost comes from the
                // inventory when the usage is logged, so none is typed here.
                description: (supplyById(p.supplyId)?.name ?? p.description).slice(0, 200),
                cost: null,
                supply_id: p.supplyId,
                supply_quantity: canonicalQuantity(p),
              }
            : {
                description: p.description.trim(),
                part_number: p.partNumber.trim() || null,
                cost: parseOptionalDecimal(p.cost) ?? null,
                quantity: parseOptionalDecimal(p.quantity) ?? null,
                url: p.url.trim() || null,
              },
        ),
    }
    // After a create whose photo upload failed, a retry updates that repair instead of creating a second.
    let id = savedId.current
    if (id !== null) {
      await updateMutation.mutateAsync({ id, ...payload })
    } else {
      id = (await createMutation.mutateAsync(payload)).id
      savedId.current = id
    }
    // Each step drops itself from the lists once done, so a retry only repeats what failed.
    for (const photoId of removedPhotoIds) {
      await deletePhotoMutation.mutateAsync({ repairId: id, photoId })
      setRemovedPhotoIds((ids) => ids.filter((x) => x !== photoId))
    }
    for (const file of pendingPhotos) {
      await uploadPhotoMutation.mutateAsync({ repairId: id, file })
      setPendingPhotos((files) => files.filter((f) => f !== file))
    }
  }

  const { error, handleSubmit } = useFormSubmit<void>(submitFn, {
    onSuccess,
    onClose,
    action: t('plannedRepairs.saveAction'),
  })
  const isSubmitting =
    createMutation.isPending ||
    updateMutation.isPending ||
    uploadPhotoMutation.isPending ||
    deletePhotoMutation.isPending

  const validate = (): boolean => {
    const errors: Record<string, string> = {}
    if (!title.trim()) errors.title = t('plannedRepairs.titleRequired')
    else if (title.trim().length > TITLE_MAX) errors.title = t('plannedRepairs.titleTooLong', { max: TITLE_MAX })
    const estimateError = moneyTextError(t, estimate)
    if (estimateError) errors.estimate = estimateError
    const rowErrors: Record<number, PartErrors> = {}
    parts.forEach((p) => {
      const row: PartErrors = {}
      if (p.supplyId != null) {
        if (!(canonicalQuantity(p) > 0)) row.supply = t('plannedRepairs.supplyQuantityRequired')
      } else {
        const costError = moneyTextError(t, p.cost)
        if (costError) row.cost = costError
        if (p.quantity.trim()) {
          const quantity = parseOptionalDecimal(p.quantity)
          if (quantity === undefined || !(quantity > 0)) row.quantity = t('plannedRepairs.qtyRequired')
        }
        if (p.url.trim() && !isWebUrl(p.url)) row.url = t('plannedRepairs.invalidUrl')
        const hasDetail = [p.partNumber, p.cost, p.quantity, p.url].some((v) => v.trim())
        if (!p.description.trim() && hasDetail) row.description = t('plannedRepairs.partDescriptionRequired')
      }
      if (Object.keys(row).length > 0) rowErrors[p.key] = row
    })
    setFieldErrors(errors)
    setPartErrors(rowErrors)
    return Object.keys(errors).length === 0 && Object.keys(rowErrors).length === 0
  }

  const onSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!validate()) return
    void handleSubmit()
  }

  const updatePart = (key: number, change: Partial<PartRow>) => {
    setParts((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)))
  }

  /** Toggle a system tag, keeping the list in the vocabulary's order. */
  const toggleSystem = (key: VehicleSystem) =>
    setSystems((current) =>
      VEHICLE_SYSTEMS.filter((s) => (s === key ? !current.includes(key) : current.includes(s))),
    )

  const addPart = (supplyId: number | null = null) => {
    setParts((rows) => [
      ...rows,
      { key: nextKey, ...emptyManual, supplyId, supplyQuantity: '', unit: unitFor(supplyId) },
    ])
    setNextKey((k) => k - 1)
  }

  return (
    <FormModalWrapper
      title={isEdit ? t('plannedRepairs.editTitle') : t('plannedRepairs.createTitle')}
      onClose={onClose}
      width="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" form="planned-repair-form" icon={Save} loading={isSubmitting} disabled={isSubmitting}>
            {isSubmitting ? t('common:saving') : isEdit ? t('common:update') : t('common:create')}
          </Button>
        </>
      }
    >
      <form id="planned-repair-form" onSubmit={onSubmit} className="p-6 space-y-4">
        {error && (
          <div className="bg-danger/10 border border-danger rounded-lg p-3">
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        <Field id="repair-title" label={t('plannedRepairs.fieldTitle')} required error={fieldErrors.title}>
          <Input
            id="repair-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('plannedRepairs.titlePlaceholder')}
            invalid={!!fieldErrors.title}
            disabled={isSubmitting}
          />
        </Field>

        <Field id="repair-description" label={t('plannedRepairs.fieldDescription')}>
          <Textarea
            id="repair-description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isSubmitting}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field id="repair-priority" label={t('plannedRepairs.fieldPriority')}>
            <Select
              id="repair-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as RepairPriority)}
              disabled={isSubmitting}
              options={REPAIR_PRIORITIES.map((p) => ({ value: p, label: t(`plannedRepairs.priority.${p}`) }))}
            />
          </Field>
          <Field id="repair-category" label={t('plannedRepairs.fieldCategory')}>
            <Select
              id="repair-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={isSubmitting}
              placeholder={t('plannedRepairs.noCategory')}
              options={SERVICE_CATEGORIES.map((c) => ({ value: c, label: c }))}
            />
          </Field>
          <Field id="repair-target-date" label={t('plannedRepairs.fieldTargetDate')}>
            <Input
              id="repair-target-date"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              disabled={isSubmitting}
            />
          </Field>
          <Field id="repair-target-odometer" label={t('plannedRepairs.fieldTargetOdometer')} unit={u.distance.label}>
            <NumberInput
              id="repair-target-odometer"
              value={odometerText}
              onChange={(e) => setOdometerText(e.target.value)}
              disabled={isSubmitting}
            />
          </Field>
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-text mb-1">{t('plannedRepairs.systems')}</legend>
          <p className="text-xs text-text-mute mb-2">{t('plannedRepairs.systemsHint')}</p>
          <div className="flex flex-wrap gap-1.5">
            {VEHICLE_SYSTEMS.map((key) => (
              <Chip
                key={key}
                selected={systems.includes(key)}
                onClick={() => toggleSystem(key)}
                disabled={isSubmitting}
              >
                {t(`plannedRepairs.system.${key}`)}
              </Chip>
            ))}
          </div>
        </fieldset>

        <Field id="repair-vendor" label={t('plannedRepairs.fieldShop')}>
          <VendorSearch value={vendorId} onSelect={(vendor) => setVendorId(vendor?.id)} disabled={isSubmitting} />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-text mb-1">{t('plannedRepairs.parts')}</legend>
          {parts.length === 0 && <p className="text-xs text-text-mute">{t('plannedRepairs.partsHint')}</p>}
          {parts.map((part, index) => (
            <div
              key={part.key}
              className={part.supplyId != null ? 'space-y-1' : 'space-y-1 rounded-lg border border-border-soft p-2'}
            >
              <div className="flex items-start gap-2">
                {part.supplyId != null ? (
                  <SupplyPartFields
                    supplies={supplies}
                    vin={vin}
                    supplyId={part.supplyId}
                    unit={part.unit}
                    quantity={part.supplyQuantity}
                    onChange={({ supplyId, quantity }) =>
                      updatePart(part.key, {
                        ...(supplyId !== undefined ? { supplyId, unit: unitFor(supplyId) } : {}),
                        ...(quantity !== undefined ? { supplyQuantity: quantity } : {}),
                      })
                    }
                    index={index}
                    invalid={!!partErrors[part.key]?.supply}
                    disabled={isSubmitting}
                  />
                ) : (
                  <ManualPartFields
                    value={part}
                    onChange={(change) => updatePart(part.key, change)}
                    index={index}
                    vehicle={vehicle}
                    invalid={{
                      cost: !!partErrors[part.key]?.cost,
                      quantity: !!partErrors[part.key]?.quantity,
                      url: !!partErrors[part.key]?.url,
                    }}
                    disabled={isSubmitting}
                  />
                )}
                <IconButton
                  icon={Trash2}
                  label={t('plannedRepairs.removePart')}
                  variant="ghost"
                  size="sm"
                  onClick={() => setParts((rows) => rows.filter((row) => row.key !== part.key))}
                  disabled={isSubmitting}
                />
              </div>
              {Object.values(partErrors[part.key] ?? {}).map((message) => (
                <p key={message} className="text-xs text-danger">
                  {message}
                </p>
              ))}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => addPart()} disabled={isSubmitting}>
              {t('plannedRepairs.addPart')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={Package}
              onClick={() => addPart(addableSupplies[0]?.id ?? null)}
              disabled={isSubmitting || addableSupplies.length === 0}
            >
              {t('plannedRepairs.addFromSupplies')}
            </Button>
          </div>
          {parts.some((p) => p.supplyId != null) && (
            <p className="text-xs text-text-mute">{t('plannedRepairs.suppliesHint')}</p>
          )}
        </fieldset>

        <div className="space-y-1">
          <PlannedRepairPhotoField
            vin={vin}
            repairId={repair?.id ?? null}
            title={title}
            stored={storedPhotos}
            pending={pendingPhotos}
            onPick={pickPhotos}
            onRemoveStored={(photoId) => setRemovedPhotoIds((ids) => [...ids, photoId])}
            onRemovePending={(index) => setPendingPhotos((files) => files.filter((_, i) => i !== index))}
            disabled={isSubmitting}
          />
          {photoError && <p className="text-xs text-danger">{photoError}</p>}
        </div>

        <Field
          id="repair-estimate"
          label={t('plannedRepairs.fieldEstimate')}
          unit={currencyCode}
          error={fieldErrors.estimate}
          hint={partsTotal > 0 ? t('plannedRepairs.partsTotal', { total: formatCurrency(partsTotal) }) : undefined}
        >
          <NumberInput
            id="repair-estimate"
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            invalid={!!fieldErrors.estimate}
            disabled={isSubmitting}
          />
        </Field>
      </form>
    </FormModalWrapper>
  )
}
