/**
 * Photos on a planned repair form: the stored ones plus files picked but not
 * uploaded yet. Nothing goes to the server here; the form uploads the pending
 * files and deletes the removed ones when the repair is saved.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, X } from 'lucide-react'
import { Button } from '../ui'
import type { PlannedRepairPhoto } from '../../types/plannedRepair'
import { MAX_REPAIR_PHOTOS, repairPhotoUrl } from '../../utils/plannedRepairPhoto'

interface PlannedRepairPhotoFieldProps {
  vin: string
  /** The repair being edited; null while creating one. */
  repairId: number | null
  title: string
  stored: PlannedRepairPhoto[]
  pending: File[]
  onPick: (files: File[]) => void
  onRemoveStored: (photoId: number) => void
  onRemovePending: (index: number) => void
  disabled?: boolean
}

export default function PlannedRepairPhotoField({
  vin,
  repairId,
  title,
  stored,
  pending,
  onPick,
  onRemoveStored,
  onRemovePending,
  disabled,
}: PlannedRepairPhotoFieldProps) {
  const { t } = useTranslation('vehicles')
  const inputRef = useRef<HTMLInputElement>(null)

  const pendingUrls = useMemo(() => pending.map((file) => URL.createObjectURL(file)), [pending])
  useEffect(() => () => pendingUrls.forEach((url) => URL.revokeObjectURL(url)), [pendingUrls])

  const total = stored.length + pending.length
  const tiles = [
    ...stored.map((photo) => ({
      key: `stored-${photo.id}`,
      src: repairPhotoUrl(vin, repairId ?? 0, photo.id),
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
      <legend className="text-sm font-medium text-text mb-1">{t('plannedRepairs.photos')}</legend>
      <p className="text-xs text-text-mute">{t('plannedRepairs.photosHint', { max: MAX_REPAIR_PHOTOS })}</p>
      {tiles.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {tiles.map((tile, index) => (
            <li key={tile.key} className="relative h-20 w-20 overflow-hidden rounded-lg border border-border bg-surface-2">
              <img
                src={tile.src}
                alt={t('plannedRepairs.photoAlt', { number: index + 1, title: title || t('plannedRepairs.createTitle') })}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                aria-label={t('plannedRepairs.removePhoto', { number: index + 1 })}
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
        data-testid="repair-photo-input"
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
        disabled={disabled || total >= MAX_REPAIR_PHOTOS}
        onClick={() => inputRef.current?.click()}
      >
        {t('plannedRepairs.addPhotos')}
      </Button>
    </fieldset>
  )
}
