import { z } from 'zod'
import type { TFunction } from 'i18next'
import { makeNotesSchema, makeOptionalDateSchema } from './shared'

/**
 * Recall schema matching backend Pydantic validators.
 * See: backend/app/schemas/recall.py
 *
 * Factory, not a constant — see the header of schemas/auth.ts for why.
 */

export const makeRecallSchema = (t: TFunction) =>
  z.object({
    nhtsa_campaign_number: z
      .string()
      .max(20, t('common:validation.recall.campaignNumberTooLong'))
      .optional(),
    component: z
      .string()
      .min(1, t('common:validation.recall.componentRequired'))
      .max(200, t('common:validation.recall.componentTooLong')),
    summary: z
      .string()
      .min(1, t('common:validation.recall.summaryRequired'))
      .max(2000, t('common:validation.recall.summaryTooLong')),
    consequence: z
      .string()
      .max(2000, t('common:validation.recall.consequenceTooLong'))
      .optional(),
    remedy: z
      .string()
      .max(2000, t('common:validation.recall.remedyTooLong'))
      .optional(),
    date_announced: makeOptionalDateSchema(t),
    is_resolved: z.boolean(),
    notes: makeNotesSchema(t).optional(),
  })

export type RecallFormData = z.infer<ReturnType<typeof makeRecallSchema>>
