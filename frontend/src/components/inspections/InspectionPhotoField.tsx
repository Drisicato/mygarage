/**
 * Photos on an inspection form: the stored ones plus files picked but not
 * uploaded yet. Nothing goes to the server here; the form uploads the pending
 * files and deletes the removed ones when the inspection is saved.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, X } from 'lucide-react'
import { Button } from '../ui'
import type { VehicleInspectionPhoto } from '../../types/vehicleInspection'
import { MAX_INSPECTION_PHOTOS, inspectionPhotoUrl } from '../../utils/inspectionChecklist'

interface InspectionPhotoFieldProps {
  vin: string
  /** The inspection being edited; null while creating one. */
  inspectionId: number | null
  stored: VehicleInspectionPhoto[]
  pending: File[]
  onPick: (files: File[]) => void
  onRemoveStored: (photoId: number) => void
  onRemovePending: (index: number) => void
  disabled?: boolean
}

export default function InspectionPhotoField({
  vin,
  inspectionId,
  stored,
  pending,
  onPick,
  onRemoveStored,
  onRemovePending,
  disabled,
}: InspectionPhotoFieldProps) {
  const { t } = useTranslation('vehicles')
  const inputRef = useRef<HTMLInputElement>(null)

  const pendingUrls = useMemo(() => pending.map((file) => URL.createObjectURL(file)), [pending])
  useEffect(() => () => pendingUrls.forEach((url) => URL.revokeObjectURL(url)), [pendingUrls])

  const total = stored.length + pending.length
  const tiles = [
    ...stored.map((photo) => ({
      key: `stored-${photo.id}`,
      src: inspectionPhotoUrl(vin, inspectionId ?? 0, photo.id),
      onRemove: () => onRemoveStored(photo.id),
    })),
    ...pending.map((file, index) => ({
      key: `pending-${index}-${file.name}`,
      src: pendingUrls[index],
      onRemove: () => onRemovePending(index),
    })),
  ]

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-text mb-1">{t('vehicleInspections.photos')}</legend>
      <p className="text-xs text-text-mute">{t('vehicleInspections.photosHint', { max: MAX_INSPECTION_PHOTOS })}</p>
      {tiles.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {tiles.map((tile, index) => (
            <li key={tile.key} className="relative h-20 w-20 overflow-hidden rounded-lg border border-border bg-surface-2">
              <img
                src={tile.src}
                alt={t('vehicleInspections.photoAlt', { number: index + 1 })}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                aria-label={t('vehicleInspections.removePhoto', { number: index + 1 })}
                onClick={tile.onRemove}
                disabled={disabled}
                className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80 disabled:opacity-50"
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        data-testid="inspection-photo-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length > 0) onPick(files)
          event.target.value = ''
        }}
      />
      <Button
        variant="secondary"
        size="sm"
        icon={ImagePlus}
        disabled={disabled || total >= MAX_INSPECTION_PHOTOS}
        onClick={() => inputRef.current?.click()}
      >
        {t('vehicleInspections.addPhotos')}
      </Button>
    </fieldset>
  )
}
