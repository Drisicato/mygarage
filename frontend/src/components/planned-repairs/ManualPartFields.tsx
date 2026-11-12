/**
 * A part or job typed in by hand on a planned repair: its name and part
 * number, the price of one and how many are needed, web searches for the
 * part number, and the link to the listing the user picked.
 */

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Search, X } from 'lucide-react'
import { Input, NumberInput } from '../ui'
import { useCurrencyPreference } from '../../hooks/useCurrencyPreference'
import { parseOptionalDecimal } from '../../utils/decimalInput'
import { partLineTotal } from '../../utils/plannedRepairParts'
import { isWebUrl, partSearchLinks, type PartSearchVehicle } from '../../utils/partSearch'

export interface ManualPartValue {
  description: string
  partNumber: string
  /** Price of one, as typed. */
  cost: string
  /** How many, as typed; blank means one. */
  quantity: string
  url: string
}

interface ManualPartFieldsProps {
  value: ManualPartValue
  onChange: (change: Partial<ManualPartValue>) => void
  index: number
  vehicle?: PartSearchVehicle | null
  /** Which inputs to mark invalid. */
  invalid?: { cost?: boolean; quantity?: boolean; url?: boolean }
  disabled?: boolean
  /** The part's picture field, shown beside the inputs. */
  image?: ReactNode
}

const linkClass =
  'inline-flex items-center gap-1 rounded-chip border border-border bg-surface-2 px-2 py-0.5 text-xs text-text-mid ui-hover-line'

export default function ManualPartFields({
  value,
  onChange,
  index,
  vehicle,
  invalid = {},
  disabled = false,
  image,
}: ManualPartFieldsProps) {
  const { t } = useTranslation('vehicles')
  const { currencyCode, formatCurrency } = useCurrencyPreference()
  const number = index + 1
  const searches = partSearchLinks(value.partNumber, vehicle)
  const total = partLineTotal(parseOptionalDecimal(value.cost) ?? null, parseOptionalDecimal(value.quantity) ?? null)
  const url = value.url.trim()

  return (
    <div className="flex flex-1 min-w-0 items-start gap-3">
      {image}
    <div className="flex-1 min-w-0 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-2">
        <Input
          aria-label={t('plannedRepairs.partName', { number })}
          value={value.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder={t('plannedRepairs.partPlaceholder')}
          disabled={disabled}
        />
        <Input
          aria-label={t('plannedRepairs.partNumberLabel', { number })}
          value={value.partNumber}
          onChange={(e) => onChange({ partNumber: e.target.value })}
          placeholder={t('plannedRepairs.partNumber')}
          maxLength={60}
          mono
          disabled={disabled}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-32">
          <NumberInput
            aria-label={t('plannedRepairs.priceEachLabel', { number })}
            value={value.cost}
            onChange={(e) => onChange({ cost: e.target.value })}
            placeholder={t('plannedRepairs.priceEach')}
            suffix={currencyCode}
            invalid={invalid.cost}
            disabled={disabled}
          />
        </div>
        <X aria-hidden="true" className="h-3.5 w-3.5 text-text-mute" />
        <div className="w-24">
          <NumberInput
            aria-label={t('plannedRepairs.qtyNeededLabel', { number })}
            value={value.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
            placeholder={t('plannedRepairs.qtyPlaceholder')}
            invalid={invalid.quantity}
            disabled={disabled}
          />
        </div>
        {total > 0 && (
          <span className="text-xs text-text-mute">
            {t('plannedRepairs.lineTotal', { total: formatCurrency(total) })}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Search aria-hidden="true" className="h-3.5 w-3.5 text-text-mute" />
        <span className="text-xs text-text-mute">{t('plannedRepairs.searchPart')}</span>
        {searches.length === 0 ? (
          <span className="text-xs text-text-mute italic">{t('plannedRepairs.searchNeedsNumber')}</span>
        ) : (
          searches.map(({ site, url: searchUrl }) => {
            const siteName = t(`plannedRepairs.searchSite.${site}`)
            return (
              <a
                key={site}
                href={searchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
                title={t('plannedRepairs.searchOn', { site: siteName })}
                aria-label={t('plannedRepairs.searchOn', { site: siteName })}
              >
                {siteName}
              </a>
            )
          })
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <Input
            inputMode="url"
            aria-label={t('plannedRepairs.partLinkLabel', { number })}
            value={value.url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder={t('plannedRepairs.partLinkPlaceholder')}
            maxLength={2000}
            invalid={invalid.url}
            disabled={disabled}
          />
        </div>
        {isWebUrl(url) && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
            title={t('plannedRepairs.openLink')}
          >
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            {t('plannedRepairs.openLink')}
          </a>
        )}
      </div>
    </div>
    </div>
  )
}
