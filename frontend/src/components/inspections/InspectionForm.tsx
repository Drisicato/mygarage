/**
 * Log or edit a multi-point inspection, laid out like the sheet: the checklist
 * sections, battery, tires and brakes per wheel, recommendations and photos.
 * Every point starts as not inspected. Tread depth and brake pads are slider
 * gauges whose band is the status, so they have no picker of their own.
 */

import { useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCheck, Save } from 'lucide-react'
import FormModalWrapper from '../FormModalWrapper'
import { Button, Field, Input, NumberInput, Textarea } from '../ui'
import InspectionStatusPicker from './InspectionStatusPicker'
import InspectionPhotoField from './InspectionPhotoField'
import InspectionGauge from './InspectionGauge'
import {
  useCreateVehicleInspection,
  useDeleteVehicleInspectionPhoto,
  useUpdateVehicleInspection,
  useUploadVehicleInspectionPhoto,
} from '../../hooks/queries/useVehicleInspections'
import { useFormSubmit } from '../../hooks/useFormSubmit'
import { useUnitFormat } from '../../hooks/useUnitFormat'
import { canonicalFromUnitField, seedUnitField, type UnitFieldOrigin } from '../../utils/unitFormat'
import { formatDateForInput } from '../../utils/dateUtils'
import { UNIT_ADAPTERS } from '../../utils/unitAdapters'
import {
  ALL_ITEM_KEYS,
  BATTERY_ITEM,
  BRAKE_GAUGE,
  CHECKLIST_SECTIONS,
  MAX_INSPECTION_PHOTOS,
  TIRE_ROTATION_ITEM,
  TREAD_GAUGE,
  cornerLabelKey,
  gaugeStatus,
  itemLabelKey,
  tread32ndsToMm,
  treadMmTo32nds,
  type InspectionNotesField,
} from '../../utils/inspectionChecklist'
import {
  INSPECTION_CORNERS,
  type InspectionCornerPosition,
  type InspectionItemKey,
  type InspectionPointStatus,
  type VehicleInspection,
  type VehicleInspectionCornerInput,
  type VehicleInspectionCreate,
} from '../../types/vehicleInspection'

const NOTES_FIELDS: readonly InspectionNotesField[] = [
  'notes_interior',
  'notes_under_hood',
  'notes_under_vehicle',
  'notes_battery',
  'notes_tires',
  'notes_brakes',
]

/** A unit-bearing number field: what's typed, and what it was seeded from. */
interface UnitText {
  text: string
  origin: UnitFieldOrigin
}

/**
 * A gauge reading, plus what it was seeded from. The gauge works in whole steps
 * (32nds, mm), so an untouched stored reading is sent back as stored rather than
 * rounded to the step.
 */
interface GaugeReading {
  value: number | null
  seededValue: number | null
  seededMm: number | null
}

interface CornerState {
  tread: GaugeReading
  brake: GaugeReading
}

const readingMm = (r: GaugeReading, toMm: (v: number | null) => number | null) =>
  r.value === r.seededValue ? r.seededMm : toMm(r.value)

interface InspectionFormProps {
  vin: string
  inspection?: VehicleInspection
  onClose: () => void
  onSuccess: () => void
}

const num = (value: string | number | null | undefined) => (value == null ? null : Number(value))

const showsNote = (status: InspectionPointStatus, note: string) =>
  status === 'yellow' || status === 'red' || note !== ''

export default function InspectionForm({ vin, inspection, onClose, onSuccess }: InspectionFormProps) {
  const { t } = useTranslation('vehicles')
  const u = useUnitFormat()
  const isEdit = !!inspection
  const createMutation = useCreateVehicleInspection(vin)
  const updateMutation = useUpdateVehicleInspection(vin)
  const uploadPhotoMutation = useUploadVehicleInspectionPhoto(vin)
  const deletePhotoMutation = useDeleteVehicleInspectionPhoto(vin)

  const [date, setDate] = useState(formatDateForInput(inspection?.date))
  const [odometerOrigin] = useState<UnitFieldOrigin>(() => seedUnitField(num(inspection?.odometer_km), u.distance))
  const [odometerText, setOdometerText] = useState(odometerOrigin.display)
  const [inspector, setInspector] = useState(inspection?.inspector ?? '')
  const [frontPressure, setFrontPressure] = useState<UnitText>(() => {
    const origin = seedUnitField(num(inspection?.tire_pressure_front_kpa), u.pressure)
    return { text: origin.display, origin }
  })
  const [rearPressure, setRearPressure] = useState<UnitText>(() => {
    const origin = seedUnitField(num(inspection?.tire_pressure_rear_kpa), u.pressure)
    return { text: origin.display, origin }
  })
  const [recommendations, setRecommendations] = useState(inspection?.recommendations ?? '')
  const [sectionNotes, setSectionNotes] = useState<Record<InspectionNotesField, string>>(
    () => Object.fromEntries(NOTES_FIELDS.map((f) => [f, inspection?.[f] ?? ''])) as Record<InspectionNotesField, string>,
  )

  const [statuses, setStatuses] = useState<Record<InspectionItemKey, InspectionPointStatus>>(() => {
    const stored = new Map((inspection?.items ?? []).map((i) => [i.item_key, i.status]))
    return Object.fromEntries(ALL_ITEM_KEYS.map((k) => [k, stored.get(k) ?? 'not_inspected'])) as Record<
      InspectionItemKey,
      InspectionPointStatus
    >
  })
  const [itemNotes, setItemNotes] = useState<Record<InspectionItemKey, string>>(() => {
    const stored = new Map((inspection?.items ?? []).map((i) => [i.item_key, i.note ?? '']))
    return Object.fromEntries(ALL_ITEM_KEYS.map((k) => [k, stored.get(k) ?? ''])) as Record<InspectionItemKey, string>
  })

  const [corners, setCorners] = useState<Record<InspectionCornerPosition, CornerState>>(() => {
    const stored = new Map((inspection?.corners ?? []).map((c) => [c.position, c]))
    const seed = (mm: number | null, toGauge: (mm: number) => number): GaugeReading => {
      const value = mm == null ? null : toGauge(mm)
      return { value, seededValue: value, seededMm: mm }
    }
    return Object.fromEntries(
      INSPECTION_CORNERS.map((position) => {
        const c = stored.get(position)
        return [
          position,
          {
            tread: seed(num(c?.tread_depth_mm), (mm) => treadMmTo32nds(mm) ?? 0),
            brake: seed(num(c?.brake_pad_mm), (mm) => Math.round(mm)),
          },
        ]
      }),
    ) as Record<InspectionCornerPosition, CornerState>
  })

  const [dateError, setDateError] = useState<string | null>(null)
  const savedId = useRef<number | null>(inspection?.id ?? null)
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([])
  const [removedPhotoIds, setRemovedPhotoIds] = useState<number[]>([])
  const [photoError, setPhotoError] = useState<string | null>(null)
  const storedPhotos = (inspection?.photos ?? []).filter((p) => !removedPhotoIds.includes(p.id))

  const pickPhotos = (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'))
    const rejected = files.find((f) => !f.type.startsWith('image/'))
    const room = MAX_INSPECTION_PHOTOS - storedPhotos.length - pendingPhotos.length
    setPhotoError(
      rejected
        ? t('vehicleInspections.photoNotImage', { name: rejected.name })
        : images.length > room
          ? t('vehicleInspections.photoLimit', { max: MAX_INSPECTION_PHOTOS })
          : null,
    )
    setPendingPhotos((current) => [...current, ...images.slice(0, Math.max(room, 0))])
  }

  const setStatus = (key: InspectionItemKey, status: InspectionPointStatus) =>
    setStatuses((current) => ({ ...current, [key]: status }))

  const markRemainingOk = (keys: readonly InspectionItemKey[]) =>
    setStatuses((current) => {
      const next = { ...current }
      for (const key of keys) if (next[key] === 'not_inspected') next[key] = 'green'
      return next
    })

  const setReading = (position: InspectionCornerPosition, which: keyof CornerState, value: number | null) =>
    setCorners((current) => ({
      ...current,
      [position]: { ...current[position], [which]: { ...current[position][which], value } },
    }))

  const cornerPayload = (position: InspectionCornerPosition): VehicleInspectionCornerInput | null => {
    const { tread, brake } = corners[position]
    if (tread.value == null && brake.value == null) return null
    return {
      position,
      tread_status: gaugeStatus(TREAD_GAUGE, tread.value) ?? 'not_inspected',
      tread_depth_mm: readingMm(tread, tread32ndsToMm),
      brake_status: gaugeStatus(BRAKE_GAUGE, brake.value) ?? 'not_inspected',
      brake_pad_mm: readingMm(brake, (v) => v),
    }
  }

  /** `6/32 in`, with the mm equivalent for a metric tread preference. */
  const formatTread = (in32: number) => {
    const text = `${in32}${UNIT_ADAPTERS.in32.label}`
    return u.tread.unit === 'mm' ? `${text} (${u.tread.format(tread32ndsToMm(in32))})` : text
  }
  const formatBrake = (mm: number) => `${mm} ${UNIT_ADAPTERS.mm.label}`

  const buildPayload = (): VehicleInspectionCreate => ({
    date,
    odometer_km: canonicalFromUnitField(odometerText, odometerOrigin, u.distance),
    inspector: inspector.trim() || null,
    tire_pressure_front_kpa: canonicalFromUnitField(frontPressure.text, frontPressure.origin, u.pressure),
    tire_pressure_rear_kpa: canonicalFromUnitField(rearPressure.text, rearPressure.origin, u.pressure),
    recommendations: recommendations.trim() || null,
    ...(Object.fromEntries(NOTES_FIELDS.map((f) => [f, sectionNotes[f].trim() || null])) as Record<
      InspectionNotesField,
      string | null
    >),
    items: ALL_ITEM_KEYS.map((key) => ({
      item_key: key,
      status: statuses[key],
      note: itemNotes[key].trim() || null,
    })),
    corners: INSPECTION_CORNERS.map(cornerPayload).filter((c): c is VehicleInspectionCornerInput => c !== null),
  })

  const submitFn = async () => {
    const payload = buildPayload()
    // After a create whose photo upload failed, a retry updates that inspection instead of creating a second.
    let id = savedId.current
    if (id !== null) {
      await updateMutation.mutateAsync({ id, ...payload })
    } else {
      id = (await createMutation.mutateAsync(payload)).id
      savedId.current = id
    }
    for (const photoId of removedPhotoIds) {
      await deletePhotoMutation.mutateAsync({ inspectionId: id, photoId })
      setRemovedPhotoIds((ids) => ids.filter((x) => x !== photoId))
    }
    for (const file of pendingPhotos) {
      await uploadPhotoMutation.mutateAsync({ inspectionId: id, file })
      setPendingPhotos((files) => files.filter((f) => f !== file))
    }
  }

  const { error, handleSubmit } = useFormSubmit<void>(submitFn, {
    onSuccess,
    onClose,
    action: t('vehicleInspections.saveAction'),
  })
  const isSubmitting =
    createMutation.isPending ||
    updateMutation.isPending ||
    uploadPhotoMutation.isPending ||
    deletePhotoMutation.isPending

  const onSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!date) {
      setDateError(t('vehicleInspections.dateRequired'))
      return
    }
    setDateError(null)
    void handleSubmit()
  }

  const itemRow = (key: InspectionItemKey) => {
    const label = t(itemLabelKey(key))
    return (
      <li key={key} className="py-2 space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-text">{label}</span>
          <InspectionStatusPicker
            value={statuses[key]}
            onChange={(status) => setStatus(key, status)}
            label={label}
            disabled={isSubmitting}
          />
        </div>
        {showsNote(statuses[key], itemNotes[key]) && (
          <Input
            aria-label={t('vehicleInspections.itemNote', { item: label })}
            value={itemNotes[key]}
            maxLength={500}
            onChange={(e) => setItemNotes((current) => ({ ...current, [key]: e.target.value }))}
            placeholder={t('vehicleInspections.itemNotePlaceholder')}
            disabled={isSubmitting}
          />
        )}
      </li>
    )
  }

  const notesBox = (field: InspectionNotesField) => (
    <Field id={`inspection-${field}`} label={t('vehicleInspections.comments')}>
      <Textarea
        id={`inspection-${field}`}
        rows={2}
        value={sectionNotes[field]}
        onChange={(e) => setSectionNotes((current) => ({ ...current, [field]: e.target.value }))}
        disabled={isSubmitting}
      />
    </Field>
  )

  const sectionShell = (title: string, children: ReactNode, okKeys?: readonly InspectionItemKey[]) => (
    <section aria-label={title} className="space-y-2 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-text">{title}</h4>
        {okKeys && (
          <Button
            variant="ghost"
            size="sm"
            icon={CheckCheck}
            onClick={() => markRemainingOk(okKeys)}
            disabled={isSubmitting || okKeys.every((k) => statuses[k] !== 'not_inspected')}
          >
            {t('vehicleInspections.markRemainingOk')}
          </Button>
        )}
      </div>
      {children}
    </section>
  )

  return (
    <FormModalWrapper
      title={isEdit ? t('vehicleInspections.editTitle') : t('vehicleInspections.createTitle')}
      onClose={onClose}
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" form="inspection-form" icon={Save} loading={isSubmitting} disabled={isSubmitting}>
            {isSubmitting ? t('common:saving') : isEdit ? t('common:update') : t('common:create')}
          </Button>
        </>
      }
    >
      <form id="inspection-form" onSubmit={onSubmit} className="p-6 space-y-4">
        {error && (
          <div className="bg-danger/10 border border-danger rounded-lg p-3">
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field id="inspection-date" label={t('vehicleInspections.fieldDate')} required error={dateError ?? undefined}>
            <Input
              id="inspection-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              invalid={!!dateError}
              disabled={isSubmitting}
            />
          </Field>
          <Field id="inspection-odometer" label={t('vehicleInspections.fieldOdometer')} unit={u.distance.label}>
            <NumberInput
              id="inspection-odometer"
              value={odometerText}
              onChange={(e) => setOdometerText(e.target.value)}
              disabled={isSubmitting}
            />
          </Field>
          <Field id="inspection-inspector" label={t('vehicleInspections.fieldInspector')}>
            <Input
              id="inspection-inspector"
              value={inspector}
              maxLength={100}
              onChange={(e) => setInspector(e.target.value)}
              placeholder={t('vehicleInspections.inspectorPlaceholder')}
              disabled={isSubmitting}
            />
          </Field>
        </div>

        <p className="text-xs text-text-mute">{t('vehicleInspections.legend')}</p>

        {CHECKLIST_SECTIONS.map((section) => (
          <div key={section.id}>
            {sectionShell(
              t(`vehicleInspections.sections.${section.id}`),
              <>
                <ul className="divide-y divide-border-soft">{section.items.map(itemRow)}</ul>
                {notesBox(section.notesField)}
              </>,
              section.items,
            )}
          </div>
        ))}

        {sectionShell(
          t('vehicleInspections.sections.battery'),
          <>
            <ul>{itemRow(BATTERY_ITEM)}</ul>
            {notesBox('notes_battery')}
          </>,
        )}

        {sectionShell(
          t('vehicleInspections.sections.tires'),
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field id="pressure-front" label={t('vehicleInspections.pressureFront')} unit={u.pressure.label}>
                <NumberInput
                  id="pressure-front"
                  value={frontPressure.text}
                  onChange={(e) => setFrontPressure((p) => ({ ...p, text: e.target.value }))}
                  disabled={isSubmitting}
                />
              </Field>
              <Field id="pressure-rear" label={t('vehicleInspections.pressureRear')} unit={u.pressure.label}>
                <NumberInput
                  id="pressure-rear"
                  value={rearPressure.text}
                  onChange={(e) => setRearPressure((p) => ({ ...p, text: e.target.value }))}
                  disabled={isSubmitting}
                />
              </Field>
            </div>
            <p className="text-xs text-text-mute">{t('vehicleInspections.treadHint')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {INSPECTION_CORNERS.map((position) => (
                <div key={position} className="rounded-md border border-border-soft p-3" data-testid={`tire-${position}`}>
                  <InspectionGauge
                    id={`tread-${position}`}
                    label={t('vehicleInspections.treadDepthAt', { corner: t(cornerLabelKey(position)) })}
                    gauge={TREAD_GAUGE}
                    value={corners[position].tread.value}
                    formatValue={formatTread}
                    onChange={(value) => setReading(position, 'tread', value)}
                    disabled={isSubmitting}
                  />
                </div>
              ))}
            </div>
            <ul>{itemRow(TIRE_ROTATION_ITEM)}</ul>
            {notesBox('notes_tires')}
          </>,
        )}

        {sectionShell(
          t('vehicleInspections.sections.brakes'),
          <>
            <p className="text-xs text-text-mute">{t('vehicleInspections.brakeHint')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {INSPECTION_CORNERS.map((position) => (
                <div key={position} className="rounded-md border border-border-soft p-3" data-testid={`brake-${position}-card`}>
                  <InspectionGauge
                    id={`brake-${position}`}
                    label={t('vehicleInspections.brakePad', { corner: t(cornerLabelKey(position)) })}
                    gauge={BRAKE_GAUGE}
                    value={corners[position].brake.value}
                    formatValue={formatBrake}
                    onChange={(value) => setReading(position, 'brake', value)}
                    disabled={isSubmitting}
                  />
                </div>
              ))}
            </div>
            {notesBox('notes_brakes')}
          </>,
        )}

        <Field id="inspection-recommendations" label={t('vehicleInspections.recommendations')}>
          <Textarea
            id="inspection-recommendations"
            rows={3}
            value={recommendations}
            onChange={(e) => setRecommendations(e.target.value)}
            disabled={isSubmitting}
          />
        </Field>

        <div className="space-y-1">
          <InspectionPhotoField
            vin={vin}
            inspectionId={inspection?.id ?? null}
            stored={storedPhotos}
            pending={pendingPhotos}
            onPick={pickPhotos}
            onRemoveStored={(photoId) => setRemovedPhotoIds((ids) => [...ids, photoId])}
            onRemovePending={(index) => setPendingPhotos((files) => files.filter((_, i) => i !== index))}
            disabled={isSubmitting}
          />
          {photoError && <p className="text-xs text-danger">{photoError}</p>}
        </div>
      </form>
    </FormModalWrapper>
  )
}
