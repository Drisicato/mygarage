import { withBase } from './basePath'

/** Most documents a warranty holds, and the largest file; the server enforces both (the size is its default). */
export const MAX_WARRANTY_DOCUMENTS = 10
export const MAX_WARRANTY_DOCUMENT_MB = 25

/** What the file picker offers; the server's allowed document types. */
export const WARRANTY_DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.jpg,.jpeg,.png'
const ALLOWED_EXTENSIONS = WARRANTY_DOCUMENT_ACCEPT.split(',')

/** True when the file's extension is one the server accepts. */
export function isWarrantyDocumentType(file: File): boolean {
  const dot = file.name.lastIndexOf('.')
  return dot >= 0 && ALLOWED_EXTENSIONS.includes(file.name.slice(dot).toLowerCase())
}

/** URL of a warranty document; it opens inline (a PDF shows in the browser) under its own name. */
export function warrantyDocumentUrl(vin: string, warrantyId: number, documentId: number): string {
  return withBase(`/api/vehicles/${vin}/warranties/${warrantyId}/documents/${documentId}`)
}
