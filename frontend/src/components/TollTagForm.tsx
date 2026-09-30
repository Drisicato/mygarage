import { useTranslation } from 'react-i18next'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Save } from 'lucide-react'
import FormModalWrapper from './FormModalWrapper'
import { Button, Field, Input, Select, Textarea } from './ui'
import type { TollTag, TollTagCreate, TollTagUpdate } from '../types/toll'
import {
  makeTollTagSchema,
  type TollTagFormData,
  TOLL_SYSTEM_OPTIONS,
} from '../schemas/tollTag'
import { useCreateTollTag, useUpdateTollTag } from '../hooks/queries/useTollRecords'
import { applyServerErrors } from '../hooks/useApiFormErrors'
import { getActionErrorMessage } from '../utils/httpErrorHandler'

interface TollTagFormProps {
  vin: string
  tag?: TollTag
  onClose: () => void
  onSuccess: () => void
}

export default function TollTagForm({ vin, tag, onClose, onSuccess }: TollTagFormProps) {
  const { t } = useTranslation('forms')
  const isEdit = !!tag
  const [error, setError] = useState<string | null>(null)
  const createMutation = useCreateTollTag(vin)
  const updateMutation = useUpdateTollTag(vin)

  // Zod bakes its messages in at construction, so the schema is rebuilt when
  // the language changes. Only the resolver depends on it — no fetch, no
  // reset() — so a rebuild can't discard what the user typed.
  const storedSystem = tag?.toll_system
  const schema = useMemo(() => makeTollTagSchema(t, storedSystem), [t, storedSystem])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError: setFieldError,
  } = useForm<TollTagFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      toll_system: tag?.toll_system ?? 'EZ TAG',
      tag_number: tag?.tag_number || '',
      status: (tag?.status as 'active' | 'inactive') || 'active',
      notes: tag?.notes || '',
    },
  })

  const onSubmit = async (data: TollTagFormData) => {
    setError(null)

    try {
      const payload: TollTagCreate | TollTagUpdate = {
        toll_system: data.toll_system,
        tag_number: data.tag_number,
        status: data.status,
        notes: data.notes,
      }

      if (!isEdit) {
        (payload as TollTagCreate).vin = vin
      }

      if (isEdit) {
        await updateMutation.mutateAsync({ id: tag.id, ...payload })
      } else {
        await createMutation.mutateAsync(payload as TollTagCreate)
      }

      onSuccess()
      onClose()
    } catch (err) {
      // attached.length === 0 catches a non-422 failure (network drop, 500):
      // it carries no field problems at all, so `unhandled` alone would stay
      // empty and this banner would never show.
      const { attached, unhandled } = applyServerErrors<TollTagFormData>(setFieldError, err, [
        'toll_system',
        'tag_number',
        'status',
        'notes',
      ])
      if (attached.length === 0 || unhandled.length > 0) {
        setError(getActionErrorMessage(err, t('toll.saveTagAction')))
      }
    }
  }

  return (
    <FormModalWrapper
      title={isEdit ? t('toll.editTagTitle') : t('toll.createTagTitle')}
      onClose={onClose}
      width="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t('tollTagForm.cancel')}
          </Button>
          <Button type="submit" form="toll-tag-form" variant="primary" icon={Save} loading={isSubmitting} disabled={isSubmitting}>
            {isSubmitting ? t('common:saving') : isEdit ? t('toll.updateTag') : t('toll.addTag')}
          </Button>
        </>
      }
    >
        <form id="toll-tag-form" onSubmit={handleSubmit(onSubmit as Parameters<typeof handleSubmit>[0])} className="p-6 space-y-4">
          {error && (
            <div className="bg-danger/10 border border-danger rounded-lg p-3">
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field id="toll_system" label={t('toll.tollSystem')} required error={errors.toll_system}>
              <Select
                id="toll_system"
                {...register('toll_system')}
                disabled={isSubmitting}
                invalid={!!errors.toll_system}
                placeholder={t('toll.selectTollSystem')}
                options={[
                  // A stored system outside the list stays selectable, or an
                  // untouched save of that tag couldn't go through.
                  ...(storedSystem && !TOLL_SYSTEM_OPTIONS.some((s) => s.value === storedSystem)
                    ? [{ value: storedSystem, label: storedSystem }]
                    : []),
                  ...TOLL_SYSTEM_OPTIONS.map((system) => ({ value: system.value, label: t(system.labelKey) })),
                ]}
              />
            </Field>

            <Field id="tag_number" label={t('toll.tagNumber')} required error={errors.tag_number}>
              <Input id="tag_number" type="text" mono {...register('tag_number')} placeholder="e.g., 0012345678" invalid={!!errors.tag_number} disabled={isSubmitting} />
            </Field>
          </div>

          <Field id="status" label={t('common:status')} error={errors.status}>
            <Select
              id="status"
              {...register('status')}
              disabled={isSubmitting}
              invalid={!!errors.status}
              options={[
                { value: 'active', label: t('common:active') },
                { value: 'inactive', label: t('common:inactive') },
              ]}
            />
          </Field>

          <Field id="notes" label={t('common:notes')} error={errors.notes}>
            <Textarea id="notes" rows={3} {...register('notes')} placeholder={t('toll.tagNotesPlaceholder')} invalid={!!errors.notes} disabled={isSubmitting} />
          </Field>
        </form>
    </FormModalWrapper>
  )
}
