import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Edit, Trash2, Save, Package, AlertTriangle, History, ChevronDown, LayoutGrid, List } from 'lucide-react'
import { toast } from 'sonner'
import {
  useSupplies,
  useCreateSupply,
  useUpdateSupply,
  useDeleteSupply,
} from '@/hooks/queries/useSupplies'
import { useQuickEntryVehicles } from '@/hooks/queries/useQuickEntryVehicles'
import { vehicleLabel } from '@/utils/vehicleLabel'
import { useUnitPreference } from '@/hooks/useUnitPreference'
import { useCurrencyPreference } from '@/hooks/useCurrencyPreference'
import { RATE_DIGITS } from '@/utils/formatUtils'
import { canonicalToDisplay, supplyUnitLabel, unitCostToDisplay } from '@/utils/supplyUnits'
import {
  canonicalCategories, filterSupplies, groupSupplies, isOutOfStock, sortSupplies,
  type SupplyFilters, type SupplyGroup,
} from '@/utils/supplyListView'
import { readSuppliesView, rememberSuppliesView, type SuppliesViewPrefs } from '@/utils/suppliesViewStore'
import { makeSupplySchema, SUPPLY_UNIT_TYPES, type SupplyFormData } from '@/schemas/supplies'
import {
  Select, Field, Input, Textarea, Checkbox, Button, SearchField, Chip, Dropdown, DataTable,
  type DropdownItem, type DataTableColumn,
} from '@/components/ui'
import FormModalWrapper from '@/components/FormModalWrapper'
import SupplyHistoryModal from '@/components/SupplyHistoryModal'
import BarcodeScanButton from '@/components/BarcodeScanButton'
import type { Supply, SupplyCreate, SupplyUpdate } from '@/types/supplies'
import { getActiveLocale } from '@/constants/i18n'
import { applyServerErrors } from '@/hooks/useApiFormErrors'
import { getActionErrorMessage } from '@/utils/httpErrorHandler'

export default function Supplies() {
  const { t } = useTranslation('common')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingSupply, setEditingSupply] = useState<Supply | null>(null)
  const [historySupply, setHistorySupply] = useState<Supply | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [vehicle, setVehicle] = useState<SupplyFilters['vehicle']>('all')
  const [outOfStockOnly, setOutOfStockOnly] = useState(false)
  const [prefs, setPrefs] = useState<SuppliesViewPrefs>(() => readSuppliesView())

  const { data, isLoading, error } = useSupplies(includeArchived)
  const deleteMutation = useDeleteSupply()
  const { system } = useUnitPreference()
  const { formatCurrency } = useCurrencyPreference()
  const { data: quickVehicles = [] } = useQuickEntryVehicles()

  const supplies = useMemo(() => data?.supplies ?? [], [data?.supplies])

  const vehicleLabelFor = (vin: string): string => {
    const known = quickVehicles.find((v) => v.vin === vin)
    return known ? vehicleLabel(known) : vin
  }

  const categories = useMemo(() => canonicalCategories(supplies), [supplies])
  const vins = useMemo(
    () => [...new Set(supplies.map((s) => s.vin).filter((vin): vin is string => vin != null))],
    [supplies],
  )

  const filters: SupplyFilters = { query, category, vehicle, outOfStock: outOfStockOnly }
  const visible = useMemo(
    () => filterSupplies(supplies, filters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supplies, query, category, vehicle, outOfStockOnly],
  )
  const anyFilterActive =
    query.trim() !== '' || category !== null || vehicle !== 'all' || outOfStockOnly

  const clearFilters = () => {
    setQuery('')
    setCategory(null)
    setVehicle('all')
    setOutOfStockOnly(false)
  }

  const updatePrefs = (patch: Partial<SuppliesViewPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      rememberSuppliesView(next)
      return next
    })
  }

  const sortItems: DropdownItem[] = [
    { id: 'name', label: t('supplies.sortByName'), checked: prefs.sort === 'name', onSelect: () => updatePrefs({ sort: 'name' }) },
    { id: 'stock', label: t('supplies.sortByLowestStock'), checked: prefs.sort === 'stock', onSelect: () => updatePrefs({ sort: 'stock' }) },
    { id: 'category', label: t('supplies.sortByCategory'), checked: prefs.sort === 'category', onSelect: () => updatePrefs({ sort: 'category' }) },
  ]
  const groupItems: DropdownItem[] = [
    { id: 'none', label: t('supplies.groupNone'), checked: prefs.group === 'none', onSelect: () => updatePrefs({ group: 'none' }) },
    { id: 'category', label: t('supplies.groupByCategory'), checked: prefs.group === 'category', onSelect: () => updatePrefs({ group: 'category' }) },
    { id: 'vehicle', label: t('supplies.groupByVehicle'), checked: prefs.group === 'vehicle', onSelect: () => updatePrefs({ group: 'vehicle' }) },
  ]
  const sortLabel = sortItems.find((i) => i.checked)?.label ?? ''
  const groupLabel = groupItems.find((i) => i.checked)?.label ?? ''

  const groups: SupplyGroup[] = groupSupplies(
    sortSupplies(visible, prefs.sort),
    prefs.group,
    vehicleLabelFor,
  )

  const groupHeading = (group: SupplyGroup): string => {
    if (group.value === null) {
      return group.kind === 'vehicle' ? t('supplies.sharedVehicle') : t('supplies.noCategory')
    }
    return group.kind === 'vehicle' ? vehicleLabelFor(group.value) : group.value
  }

  const handleAddClick = () => {
    setEditingSupply(null)
    setShowForm(true)
  }

  const handleEditClick = (supply: Supply) => {
    setEditingSupply(supply)
    setShowForm(true)
  }

  const handleCloseForm = () => {
    setShowForm(false)
    setEditingSupply(null)
  }

  const handleDelete = (supply: Supply) => {
    if (!confirm(t('supplies.confirmDelete'))) return

    deleteMutation.mutate(supply.id, {
      onSuccess: () => toast.success(t('supplies.deleted')),
      onError: (err) => toast.error(getActionErrorMessage(err, t('supplies.deleteAction'))),
    })
  }

  const formatOnHand = (supply: Supply): string => {
    const value = canonicalToDisplay(Number(supply.on_hand), supply.unit_type, system)
    if (supply.unit_type === 'count') {
      return Math.round(value).toLocaleString(getActiveLocale())
    }
    const label = supplyUnitLabel(supply.unit_type, system)
    return `${value.toFixed(2)} ${label}`.trim()
  }

  const avgCostLabel = (supply: Supply): string => {
    const unit = supplyUnitLabel(supply.unit_type, system)
    return unit ? t('supplies.avgCostPerUnit', { unit }) : t('supplies.avgUnitCost')
  }

  const renderActions = (supply: Supply) => (
    <>
      <button
        onClick={() => setHistorySupply(supply)}
        className="text-garage-text-muted hover:text-primary transition-colors"
        aria-label={t('supplies.viewHistory')}
        title={t('supplies.viewHistory')}
      >
        <History className="w-4 h-4" />
      </button>
      <button
        onClick={() => handleEditClick(supply)}
        className="text-garage-text-muted hover:text-primary transition-colors"
        aria-label={t('common:edit')}
        title={t('common:edit')}
      >
        <Edit className="w-4 h-4" />
      </button>
      <button
        onClick={() => handleDelete(supply)}
        disabled={deleteMutation.isPending && deleteMutation.variables === supply.id}
        className="text-garage-text-muted hover:text-danger transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={t('common:delete')}
        title={t('common:delete')}
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </>
  )

  const listColumns: DataTableColumn<Supply>[] = [
    {
      id: 'name',
      header: t('supplies.name'),
      render: (s) => (
        <div>
          <div className="font-medium text-garage-text">{s.name}</div>
          {s.part_number && <div className="text-xs text-garage-text-muted">{s.part_number}</div>}
        </div>
      ),
    },
    { id: 'category', header: t('supplies.category'), render: (s) => s.category ?? '' },
    {
      id: 'vehicle',
      header: t('supplies.vehicle'),
      render: (s) => (s.vin ? vehicleLabelFor(s.vin) : t('supplies.sharedVehicle')),
    },
    {
      id: 'on_hand',
      header: t('supplies.onHand'),
      align: 'right',
      mono: true,
      render: (s) => (
        <span className="inline-flex items-center gap-2">
          {isOutOfStock(s) && (
            <Chip tone={s.is_negative ? 'danger' : 'warning'}>{t('supplies.outOfStock')}</Chip>
          )}
          {formatOnHand(s)}
        </span>
      ),
    },
    {
      id: 'avg_cost',
      header: t('supplies.avgUnitCost'),
      align: 'right',
      mono: true,
      render: (s) =>
        formatCurrency(unitCostToDisplay(s.avg_unit_cost, s.unit_type, system), {
          fractionDigits: RATE_DIGITS,
        }),
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      render: (s) => <div className="flex justify-end gap-2">{renderActions(s)}</div>,
    },
  ]

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2 text-garage-text">{t('supplies.title')}</h1>
        <p className="text-garage-text-muted">{t('supplies.subtitle')}</p>
      </div>

      {/* Controls */}
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <SearchField
            value={query}
            onChange={setQuery}
            label={t('supplies.searchSupplies')}
            placeholder={t('supplies.searchSupplies')}
            className="w-full sm:w-56"
          />
          <Select
            aria-label={t('supplies.filterByCategory')}
            value={category ?? ''}
            onChange={(e) => setCategory(e.target.value || null)}
            placeholder={t('supplies.allCategories')}
            options={categories.map((c) => ({ value: c, label: c }))}
            className="sm:w-48"
          />
          <Select
            aria-label={t('supplies.filterByVehicle')}
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value)}
            options={[
              { value: 'all', label: t('supplies.allVehicles') },
              { value: 'shared', label: t('supplies.sharedVehicle') },
              ...vins.map((vin) => ({ value: vin, label: vehicleLabelFor(vin) })),
            ]}
            className="sm:w-48"
          />
          <Chip selected={outOfStockOnly} onClick={() => setOutOfStockOnly((prev) => !prev)}>
            {t('supplies.outOfStock')}
          </Chip>
          <div className="flex-1" />
          <Dropdown
            label={t('supplies.sortSupplies')}
            align="right"
            items={sortItems}
            trigger={
              <>
                {t('supplies.sortTrigger', { label: sortLabel })}
                <ChevronDown aria-hidden="true" className="h-4 w-4" />
              </>
            }
          />
          <Dropdown
            label={t('supplies.groupSupplies')}
            align="right"
            items={groupItems}
            trigger={
              <>
                {t('supplies.groupTrigger', { label: groupLabel })}
                <ChevronDown aria-hidden="true" className="h-4 w-4" />
              </>
            }
          />
          <div className="flex gap-1">
            <button
              type="button"
              aria-label={t('supplies.gridView')}
              aria-pressed={prefs.view === 'grid'}
              onClick={() => updatePrefs({ view: 'grid' })}
              className={`p-2 border rounded-lg transition-colors ${
                prefs.view === 'grid'
                  ? 'bg-primary text-(--accent-on-solid) border-primary'
                  : 'bg-garage-surface text-garage-text border-garage-border hover:border-primary'
              }`}
            >
              <LayoutGrid aria-hidden="true" className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label={t('supplies.listView')}
              aria-pressed={prefs.view === 'list'}
              onClick={() => updatePrefs({ view: 'list' })}
              className={`p-2 border rounded-lg transition-colors ${
                prefs.view === 'list'
                  ? 'bg-primary text-(--accent-on-solid) border-primary'
                  : 'bg-garage-surface text-garage-text border-garage-border hover:border-primary'
              }`}
            >
              <List aria-hidden="true" className="w-4 h-4" />
            </button>
          </div>
        </div>

        {anyFilterActive && (
          <div className="flex items-center gap-3 mb-4 text-sm text-garage-text-muted">
            <span>{t('supplies.showingResults', { shown: visible.length, total: supplies.length })}</span>
            <button type="button" onClick={clearFilters} className="text-primary hover:underline">
              {t('supplies.clearFilters')}
            </button>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <button
            type="button"
            onClick={() => setIncludeArchived((prev) => !prev)}
            className={`px-4 py-2 border rounded-lg transition-colors ${
              includeArchived
                ? 'bg-primary text-(--accent-on-solid) border-primary'
                : 'bg-garage-surface text-garage-text border-garage-border hover:border-primary'
            }`}
          >
            {t('supplies.showArchived')}
          </button>

          <div className="flex-1" />

          <button
            onClick={handleAddClick}
            className="flex items-center gap-2 px-5 py-3 btn btn-primary rounded-lg"
          >
            <Plus className="w-5 h-5" />
            {t('supplies.addSupply')}
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 bg-danger/10 border border-danger/20 rounded-md mb-4">
            <AlertTriangle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
            <p className="text-sm text-danger">
              {getActionErrorMessage(error, t('supplies.loadAction'))}
            </p>
          </div>
        )}

        {/* Supplies List */}
        {isLoading ? (
          <div className="text-center py-12 text-garage-text-muted">{t('supplies.loading')}</div>
        ) : supplies.length === 0 ? (
          <div className="text-center py-12">
            <Package className="w-16 h-16 text-garage-text-muted mx-auto mb-4" />
            <p className="text-garage-text-muted mb-4">{t('supplies.noSupplies')}</p>
            <button
              onClick={handleAddClick}
              className="inline-flex items-center gap-2 px-5 py-3 btn btn-primary rounded-lg"
            >
              <Plus className="w-5 h-5" />
              {t('supplies.addFirstSupply')}
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-12">
            <Package className="w-16 h-16 text-garage-text-muted mx-auto mb-4" />
            <p className="text-garage-text-muted">{t('supplies.noMatches')}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.value ?? '__trailing__'}>
                {prefs.group !== 'none' && (
                  <h2 className="text-lg font-semibold text-garage-text mb-3">
                    {groupHeading(group)}{' '}
                    <span className="text-sm font-normal text-garage-text-muted">
                      ({group.supplies.length})
                    </span>
                  </h2>
                )}
                {prefs.view === 'list' ? (
                  <DataTable
                    caption={t('supplies.tableCaption')}
                    columns={listColumns}
                    rows={group.supplies}
                    rowKey={(s) => String(s.id)}
                  />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {group.supplies.map((supply) => {
                      const archived = supply.is_active === false
                      const stockBorder = supply.is_negative
                        ? 'border-danger/50'
                        : isOutOfStock(supply)
                          ? 'border-warning/50'
                          : 'border-garage-border'
                      return (
                        <div
                          key={supply.id}
                          className={`bg-garage-surface border rounded-lg p-4 transition-colors ${
                            archived ? 'border-garage-border opacity-60' : `${stockBorder} hover:border-primary/50`
                          }`}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <h3 className="font-semibold text-garage-text text-lg">{supply.name}</h3>
                              {archived && (
                                <span className="inline-block px-2 py-0.5 bg-garage-bg text-garage-text-muted rounded text-xs mt-1">
                                  {t('supplies.archived')}
                                </span>
                              )}
                            </div>
                            <div className="flex gap-2">{renderActions(supply)}</div>
                          </div>

                          <div className="space-y-2 text-sm">
                            {supply.category && (
                              <div className="inline-block px-2 py-1 bg-primary/10 text-primary rounded text-xs">
                                {supply.category}
                              </div>
                            )}

                            {supply.part_number && (
                              <div className="text-garage-text-muted">{supply.part_number}</div>
                            )}

                            <div className="text-garage-text-muted text-xs">
                              {supply.vin ? vehicleLabelFor(supply.vin) : t('supplies.sharedVehicle')}
                            </div>

                            {isOutOfStock(supply) && (
                              <div>
                                <Chip tone={supply.is_negative ? 'danger' : 'warning'}>
                                  {t('supplies.outOfStock')}
                                </Chip>
                              </div>
                            )}

                            {supply.barcode && (
                              <div className="text-garage-text-muted font-mono text-xs">
                                {t('supplies.barcode')}: {supply.barcode}
                              </div>
                            )}

                            <div className="flex items-center justify-between">
                              <span className="text-garage-text-muted">{t('supplies.onHand')}</span>
                              <span className="font-medium text-garage-text">{formatOnHand(supply)}</span>
                            </div>

                            <div className="flex items-center justify-between">
                              <span className="text-garage-text-muted">{avgCostLabel(supply)}</span>
                              <span className="font-medium text-garage-text">{formatCurrency(unitCostToDisplay(supply.avg_unit_cost, supply.unit_type, system), { fractionDigits: RATE_DIGITS })}</span>
                            </div>

                            {supply.is_negative && (
                              <div className="flex items-center gap-2 px-2 py-1 bg-danger/10 text-danger rounded text-xs">
                                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                                <span>{t('supplies.negativeWarning')}</span>
                              </div>
                            )}

                            {supply.notes && (
                              <p className="text-garage-text-muted text-xs mt-2 pt-2 border-t border-garage-border">
                                {supply.notes}
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Form Modal */}
      {showForm && (
        <SupplyForm supply={editingSupply} onClose={handleCloseForm} onSuccess={handleCloseForm} />
      )}

      {/* History Modal */}
      {historySupply && (
        <SupplyHistoryModal supply={historySupply} onClose={() => setHistorySupply(null)} />
      )}
    </div>
  )
}

// Form Component
interface SupplyFormProps {
  supply?: Supply | null
  onClose: () => void
  onSuccess: () => void
}

export function SupplyForm({ supply, onClose, onSuccess }: SupplyFormProps) {
  const { t } = useTranslation('common')
  const isEdit = !!supply
  const [error, setError] = useState<string | null>(null)
  const [isActive, setIsActive] = useState(supply?.is_active ?? true)
  const createMutation = useCreateSupply()
  const updateMutation = useUpdateSupply()
  const { data: vehicles = [] } = useQuickEntryVehicles()

  // Zod bakes its messages in at construction, so the schema is rebuilt when
  // the language changes. Only the resolver depends on it — no fetch, no
  // reset() — so a rebuild can't discard what the user typed.
  const schema = useMemo(() => makeSupplySchema(t), [t])

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
    setError: setFieldError,
  } = useForm<SupplyFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: supply?.name || '',
      unit_type: supply?.unit_type || 'volume',
      part_number: supply?.part_number || '',
      barcode: supply?.barcode || '',
      category: supply?.category || '',
      notes: supply?.notes || '',
      vin: supply?.vin || '',
    },
  })

  const onSubmit = async (data: SupplyFormData) => {
    setError(null)

    try {
      if (isEdit && supply) {
        const payload: SupplyUpdate = {
          name: data.name,
          part_number: data.part_number || null,
          barcode: data.barcode || null,
          category: data.category || null,
          notes: data.notes || null,
          vin: data.vin || null,
          is_active: isActive,
        }
        await updateMutation.mutateAsync({ id: supply.id, ...payload })
      } else {
        const payload: SupplyCreate = {
          name: data.name,
          unit_type: data.unit_type,
          part_number: data.part_number || undefined,
          barcode: data.barcode || undefined,
          category: data.category || undefined,
          notes: data.notes || undefined,
          vin: data.vin || undefined,
        }
        await createMutation.mutateAsync(payload)
      }

      onSuccess()
      onClose()
    } catch (err) {
      // attached.length === 0 catches a non-422 failure (network drop, 500):
      // it carries no field problems at all, so `unhandled` alone would stay
      // empty and this banner would never show.
      const { attached, unhandled } = applyServerErrors<SupplyFormData>(setFieldError, err, [
        'name',
        'unit_type',
        'part_number',
        'category',
        'notes',
        'vin',
      ])
      if (attached.length === 0 || unhandled.length > 0) {
        setError(getActionErrorMessage(err, t('supplies.saveAction')))
      }
    }
  }

  return (
    <FormModalWrapper
      title={isEdit ? t('supplies.editSupply') : t('supplies.addSupply')}
      onClose={onClose}
      width="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t('common:cancel')}
          </Button>
          <Button
            type="submit"
            form="supply-form"
            variant="primary"
            icon={Save}
            loading={isSubmitting}
            disabled={isSubmitting}
          >
            {isSubmitting ? t('common:saving') : isEdit ? t('common:update') : t('common:create')}
          </Button>
        </>
      }
    >
      <form id="supply-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4 p-6">
        {error && (
          <div className="rounded-lg border border-danger bg-danger/10 p-3">
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="name" label={t('supplies.name')} required error={errors.name}>
            <Input
              id="name"
              type="text"
              {...register('name')}
              placeholder={t('suppliesPage.namePlaceholder')}
              invalid={!!errors.name}
              disabled={isSubmitting}
            />
          </Field>

          <Field
            id="unit_type"
            label={t('supplies.unitType')}
            required
            error={errors.unit_type}
            hint={isEdit ? t('supplies.unitTypeImmutable') : undefined}
          >
            <Select
              id="unit_type"
              {...register('unit_type')}
              disabled={isSubmitting || isEdit}
              invalid={!!errors.unit_type}
              options={SUPPLY_UNIT_TYPES.map((unitType) => ({
                value: unitType,
                label: unitType === 'volume' ? t('supplies.unitTypeVolume') : t('supplies.unitTypeCount'),
              }))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="part_number" label={t('supplies.partNumber')} error={errors.part_number}>
            <Input
              id="part_number"
              type="text"
              {...register('part_number')}
              invalid={!!errors.part_number}
              disabled={isSubmitting}
            />
          </Field>

          <Field id="category" label={t('supplies.category')} error={errors.category}>
            <Input
              id="category"
              type="text"
              {...register('category')}
              placeholder={t('suppliesPage.categoryPlaceholder')}
              invalid={!!errors.category}
              disabled={isSubmitting}
            />
          </Field>
        </div>

        <Field id="barcode" label={t('supplies.barcode')} error={errors.barcode}>
          <div className="flex gap-2 items-start">
            <Input
              id="barcode"
              type="text"
              {...register('barcode')}
              invalid={!!errors.barcode}
              disabled={isSubmitting}
              className="flex-1"
            />
            <BarcodeScanButton
              onScan={(code) => setValue('barcode', code, { shouldDirty: true, shouldValidate: true })}
            />
          </div>
        </Field>

        <Field id="vin" label={t('supplies.vehicle')} error={errors.vin}>
          <Select
            id="vin"
            {...register('vin')}
            disabled={isSubmitting}
            invalid={!!errors.vin}
            placeholder={t('supplies.sharedAcrossVehicles')}
            options={vehicles.map((v) => ({ value: v.vin, label: vehicleLabel(v) }))}
          />
        </Field>

        <Field id="notes" label={t('common:notes')} error={errors.notes}>
          <Textarea id="notes" rows={3} {...register('notes')} invalid={!!errors.notes} disabled={isSubmitting} />
        </Field>

        {isEdit && (
          <Checkbox
            id="is_active"
            label={t('supplies.activeToggle')}
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            disabled={isSubmitting}
          />
        )}
      </form>
    </FormModalWrapper>
  )
}
