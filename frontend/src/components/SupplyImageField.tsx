import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Package, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui'
import type { Supply } from '@/types/supplies'
import { googleImageSearchUrl, supplyImageUrl } from '@/utils/supplyImage'

interface SupplyImageFieldProps {
  /** The supply being edited; null while creating one. */
  supply: Supply | null
  /** What the form currently says, so the Google search follows unsaved edits. */
  name: string
  partNumber: string
  /** An image picked (or pasted) but not uploaded yet; it goes up when the form saves. */
  pendingFile: File | null
  onPickFile: (file: File) => void
  /** The stored image is to be removed when the form saves. */
  removeStored: boolean
  onClear: () => void
  disabled?: boolean
}

export default function SupplyImageField({
  supply,
  name,
  partNumber,
  pendingFile,
  onPickFile,
  removeStored,
  onClear,
  disabled,
}: SupplyImageFieldProps) {
  const { t } = useTranslation('common')
  const inputRef = useRef<HTMLInputElement>(null)
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!pendingFile) {
      setPendingUrl(null)
      return
    }
    const url = URL.createObjectURL(pendingFile)
    setPendingUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pendingFile])

  const storedUrl = supply?.has_image && !removeStored ? supplyImageUrl(supply.id, supply.updated_at) : null
  const shownUrl = pendingUrl ?? storedUrl
  const searchUrl = googleImageSearchUrl(name, partNumber)

  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-garage-text">{t('supplies.image')}</span>
      <div className="flex items-start gap-4">
        <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-garage-border bg-garage-bg">
          {shownUrl ? (
            <img
              src={shownUrl}
              alt={t('supplies.imageAlt', { name: name || supply?.name || '' })}
              className="h-full w-full object-contain"
            />
          ) : (
            <Package aria-hidden="true" className="h-8 w-8 text-garage-text-muted" />
          )}
        </div>
        <div className="space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid="supply-image-input"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) onPickFile(file)
              event.target.value = ''
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={ImagePlus} disabled={disabled} onClick={() => inputRef.current?.click()}>
              {shownUrl ? t('supplies.imageReplace') : t('supplies.imageChoose')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={Search}
              disabled={disabled || !searchUrl}
              title={searchUrl ? undefined : t('supplies.imageSearchNeedsText')}
              onClick={() => {
                if (searchUrl) window.open(searchUrl, '_blank', 'noopener,noreferrer')
              }}
            >
              {t('supplies.imageSearchGoogle')}
            </Button>
            {shownUrl && (
              <Button variant="ghost" size="sm" icon={Trash2} disabled={disabled} onClick={onClear}>
                {t('supplies.imageRemove')}
              </Button>
            )}
          </div>
          <p className="text-xs text-garage-text-muted">{t('supplies.imageSearchHint')}</p>
        </div>
      </div>
    </div>
  )
}
