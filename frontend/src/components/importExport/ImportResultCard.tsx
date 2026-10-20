import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, Mono } from '../ui'
import { getActionErrorMessage } from '../../utils/httpErrorHandler'
import { downloadBackup } from './download'
import type { ImportSummary } from './importCatalog'

/** Errors listed; the rest are counted. */
const SHOWN_ERRORS = 8

interface ImportResultCardProps {
  vin: string
  summary: ImportSummary
  /** A preview: what the import would do, nothing written. */
  preview: boolean
}

/** What a preview found, or what an import did, plus the backup it took. */
export default function ImportResultCard({ vin, summary, preview }: ImportResultCardProps) {
  const { t } = useTranslation('settings')
  const counts = {
    imported: summary.success_count,
    skipped: summary.skipped_count,
    failed: summary.error_count,
  }

  const download = async (filename: string) => {
    try {
      await downloadBackup(vin, filename)
    } catch (err) {
      toast.error(getActionErrorMessage(err, t('importExport.backupAction')))
    }
  }

  return (
    <Card padding="sm">
      <p className="text-sm font-medium text-text">
        {preview ? t('importExport.previewTitle') : t('importExport.doneTitle')}
      </p>
      <p className="mt-1 text-sm text-text-mute">
        {preview ? t('importExport.previewSummary', counts) : t('importExport.doneSummary', counts)}
      </p>
      {summary.details && <p className="mt-2 whitespace-pre-line text-xs text-text-mute">{summary.details}</p>}
      {summary.errors.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {summary.errors.slice(0, SHOWN_ERRORS).map((e) => (
            <p key={e} className="text-xs text-danger">{e}</p>
          ))}
          {summary.errors.length > SHOWN_ERRORS && (
            <p className="text-xs text-text-mute">
              {t('importExport.moreErrors', { count: summary.errors.length - SHOWN_ERRORS })}
            </p>
          )}
        </div>
      )}
      {preview && <p className="mt-2 text-xs text-text-mute">{t('importExport.backupNote')}</p>}
      {!preview && summary.backupFilename && (
        <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3 space-y-2">
          <p className="text-sm text-text">{t('importExport.backupSaved')}</p>
          <Mono size="sm" tone="muted">{summary.backupFilename}</Mono>
          <div>
            <Button
              variant="secondary"
              size="sm"
              icon={Download}
              onClick={() => void download(summary.backupFilename as string)}
            >
              {t('importExport.downloadBackup')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
