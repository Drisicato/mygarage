/**
 * A planned repair part's picture, like a supply's: pick or drop an image,
 * or find one with Google Images. Nothing uploads until the form saves.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Search, Trash2 } from 'lucide-react'
import { IconButton } from '../ui'
import { firstImageFile, googleImageSearchUrl } from '../../utils/supplyImage'

interface PartImageFieldProps {
  index: number
  /** URL of the stored picture; null when the part has none (or it's being removed). */
  storedUrl: string | null
  /** A picked image not uploaded yet. */
  pendingFile: File | null
  onPick: (file: File) => void
  onClear: () => void
  /** What the row says now, so the search follows unsaved edits. */
  name: string
  partNumber: string
  disabled?: boolean
}

export default function PartImageField({
  index,
  storedUrl,
  pendingFile,
  onPick,
  onClear,
  name,
  partNumber,
  disabled = false,
}: PartImageFieldProps) {
  const { t } = useTranslation('vehicles')
  const inputRef = useRef<HTMLInputElement>(null)
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const number = index + 1

  useEffect(() => {
    if (!pendingFile) {
      setPendingUrl(null)
      return
    }
    const url = URL.createObjectURL(pendingFile)
    setPendingUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pendingFile])

  const shownUrl = pendingUrl ?? storedUrl
  const searchUrl = googleImageSearchUrl(name, partNumber)

  return (
    <div className="flex w-20 flex-shrink-0 flex-col items-center gap-1">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const file = firstImageFile(e.dataTransfer.files)
          if (file && !disabled) onPick(file)
        }}
        disabled={disabled}
        aria-label={
          shownUrl
            ? t('plannedRepairs.partImageReplace', { number })
            : t('plannedRepairs.partImageChoose', { number })
        }
        title={t('plannedRepairs.partImageHint')}
        className={`flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border bg-surface-2 ui-hover-line ${
          dragging ? 'border-(--accent-line) bg-(--accent-soft)' : 'border-border'
        }`}
      >
        {shownUrl ? (
          <img
            src={shownUrl}
            alt={t('plannedRepairs.partImageAlt', { name: name || String(number) })}
            className="h-full w-full object-contain"
          />
        ) : (
          <ImagePlus aria-hidden="true" className="h-6 w-6 text-text-mute" />
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid={`part-image-input-${index}`}
        onChange={(e) => {
          const file = firstImageFile(e.target.files)
          if (file) onPick(file)
          e.target.value = ''
        }}
      />
      <div className="flex items-center">
        <IconButton
          icon={Search}
          label={t('plannedRepairs.partImageSearch', { number })}
          title={searchUrl ? t('plannedRepairs.partImageSearchTitle') : t('plannedRepairs.partImageSearchNeedsText')}
          variant="ghost"
          size="sm"
          disabled={disabled || !searchUrl}
          onClick={() => {
            if (searchUrl) window.open(searchUrl, '_blank', 'noopener,noreferrer')
          }}
        />
        {shownUrl && (
          <IconButton
            icon={Trash2}
            label={t('plannedRepairs.partImageRemove', { number })}
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onClear}
          />
        )}
      </div>
    </div>
  )
}
