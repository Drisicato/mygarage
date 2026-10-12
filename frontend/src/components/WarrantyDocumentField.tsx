/**
 * Documents on the warranty form: the stored ones plus files picked but not
 * uploaded yet. Nothing goes to the server here; the form uploads the pending
 * files and deletes the removed ones when the warranty is saved.
 */

import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Paperclip, X } from 'lucide-react'
import { Button } from './ui'
import type { WarrantyDocument } from '../types/warranty'
import {
  MAX_WARRANTY_DOCUMENTS,
  MAX_WARRANTY_DOCUMENT_MB,
  WARRANTY_DOCUMENT_ACCEPT,
  warrantyDocumentUrl,
} from '../utils/warrantyDocument'

interface WarrantyDocumentFieldProps {
  vin: string
  /** The warranty being edited; null while creating one. */
  warrantyId: number | null
  stored: WarrantyDocument[]
  pending: File[]
  onPick: (files: File[]) => void
  onRemoveStored: (documentId: number) => void
  onRemovePending: (index: number) => void
  error?: string | null
  disabled?: boolean
}

const sizeLabel = (bytes?: number | null) =>
  bytes == null ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

export default function WarrantyDocumentField({
  vin,
  warrantyId,
  stored,
  pending,
  onPick,
  onRemoveStored,
  onRemovePending,
  error,
  disabled,
}: WarrantyDocumentFieldProps) {
  const { t } = useTranslation('forms')
  const inputRef = useRef<HTMLInputElement>(null)
  const total = stored.length + pending.length

  const rows = [
    ...stored.map((doc) => ({
      key: `stored-${doc.id}`,
      name: doc.file_name,
      size: sizeLabel(doc.file_size),
      href: warrantyDocumentUrl(vin, warrantyId ?? 0, doc.id),
      onRemove: () => onRemoveStored(doc.id),
    })),
    ...pending.map((file, index) => ({
      key: `pending-${index}-${file.name}`,
      name: file.name,
      size: sizeLabel(file.size),
      href: null,
      onRemove: () => onRemovePending(index),
    })),
  ]

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-text mb-1">{t('warrantyForm.documents')}</legend>
      <p className="text-xs text-text-mute">
        {t('warrantyForm.documentsHint', { max: MAX_WARRANTY_DOCUMENTS, size: MAX_WARRANTY_DOCUMENT_MB })}
      </p>
      {rows.length > 0 && (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2"
            >
              <FileText aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-text-mute" />
              {row.href ? (
                <a
                  href={row.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('warrantyForm.openDocument', { name: row.name })}
                  className="min-w-0 flex-1 truncate text-sm text-(--accent-fg) hover:underline"
                >
                  {row.name}
                </a>
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm text-text">{row.name}</span>
              )}
              <span className="flex-shrink-0 text-xs text-text-mute">{row.size}</span>
              <button
                type="button"
                aria-label={t('warrantyForm.removeDocument', { name: row.name })}
                onClick={row.onRemove}
                disabled={disabled}
                className="flex-shrink-0 rounded p-0.5 text-text-mute hover:text-danger disabled:opacity-50"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={WARRANTY_DOCUMENT_ACCEPT}
        multiple
        className="hidden"
        data-testid="warranty-document-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length > 0) onPick(files)
          event.target.value = ''
        }}
      />
      <Button
        variant="secondary"
        size="sm"
        icon={Paperclip}
        disabled={disabled || total >= MAX_WARRANTY_DOCUMENTS}
        onClick={() => inputRef.current?.click()}
      >
        {t('warrantyForm.addDocuments')}
      </Button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </fieldset>
  )
}
