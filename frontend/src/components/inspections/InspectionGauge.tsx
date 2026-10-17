/**
 * A slider gauge for a wear reading (tread depth, brake pad), with its red,
 * yellow and green bands painted on the track. The band the reading falls in is
 * the point's status, so there is no separate picker. Nothing is recorded until
 * the slider is touched; Clear returns it to not measured.
 */

import { useTranslation } from 'react-i18next'
import { Chip } from '../ui'
import type { Tone } from '../ui'
import { gaugeStatus, type Gauge } from '../../utils/inspectionChecklist'
import type { InspectionPointStatus } from '../../types/vehicleInspection'

const STATUS_TONE: Record<InspectionPointStatus, Tone> = {
  green: 'success',
  yellow: 'warning',
  red: 'danger',
  not_inspected: 'muted',
}

interface InspectionGaugeProps {
  id: string
  label: string
  gauge: Gauge
  /** The reading in the gauge's own unit, or null when not measured. */
  value: number | null
  /** Renders a reading for display, e.g. `6/32 in` or `6 mm`. */
  formatValue: (value: number) => string
  onChange: (value: number | null) => void
  disabled?: boolean
}

/** `appearance-none` drops the native thumb in WebKit, so it's drawn here for both engines. */
const THUMB =
  '[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none ' +
  '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-surface ' +
  '[&::-webkit-slider-thumb]:bg-text [&::-webkit-slider-thumb]:shadow ' +
  '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full ' +
  '[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-surface [&::-moz-range-thumb]:bg-text'

/** The track: red up to yellowFrom, yellow up to greenFrom, green to the end. */
function trackBackground(gauge: Gauge): string {
  const span = gauge.max - gauge.min
  // Band edges sit halfway between steps, so each step's colour matches its status.
  const pct = (v: number) => `${(((v - gauge.step / 2 - gauge.min) / span) * 100).toFixed(2)}%`
  const yellow = pct(gauge.yellowFrom)
  const green = pct(gauge.greenFrom)
  return (
    'linear-gradient(to right, ' +
    `var(--color-danger) 0%, var(--color-danger) ${yellow}, ` +
    `var(--color-warning) ${yellow}, var(--color-warning) ${green}, ` +
    `var(--color-success) ${green}, var(--color-success) 100%)`
  )
}

export default function InspectionGauge({
  id,
  label,
  gauge,
  value,
  formatValue,
  onChange,
  disabled = false,
}: InspectionGaugeProps) {
  const { t } = useTranslation('vehicles')
  const status = gaugeStatus(gauge, value) ?? 'not_inspected'
  const measured = value != null
  const commit = (raw: string) => onChange(Number(raw))

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm text-text">
          {label}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text tabular-nums" data-testid={`${id}-value`}>
            {measured ? formatValue(value) : t('vehicleInspections.notMeasured')}
          </span>
          <Chip tone={STATUS_TONE[status]}>{t(`vehicleInspections.status.${status}`)}</Chip>
          {measured && (
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={disabled}
              className="text-xs text-text-mute underline hover:text-text disabled:opacity-50"
            >
              {t('vehicleInspections.clearReading')}
            </button>
          )}
        </div>
      </div>
      <input
        id={id}
        type="range"
        min={gauge.min}
        max={gauge.max}
        step={gauge.step}
        // Unmeasured sits at the top of the scale, dimmed, until it's moved.
        value={value ?? gauge.max}
        aria-valuetext={measured ? `${formatValue(value)}, ${t(`vehicleInspections.status.${status}`)}` : t('vehicleInspections.notMeasured')}
        onChange={(e) => commit(e.target.value)}
        // A click on the thumb's current spot fires no change, so it records the reading too.
        onPointerUp={(e) => {
          if (!measured) commit(e.currentTarget.value)
        }}
        disabled={disabled}
        className={`h-2 w-full cursor-pointer appearance-none rounded-full ui-focus-ring disabled:cursor-not-allowed ${THUMB} ${
          measured ? '' : 'opacity-40'
        }`}
        style={{ background: trackBackground(gauge) }}
      />
      <div className="flex justify-between text-[10px] text-text-mute tabular-nums" aria-hidden="true">
        <span>{formatValue(gauge.min)}</span>
        <span>{formatValue(gauge.max)}</span>
      </div>
    </div>
  )
}
