import { AlertTriangle, ChevronDown, Loader2 } from 'lucide-react'
import { useRef, useState, type FormEvent, type RefObject } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ApiError, apisApi, dataSourcesApi, fieldErrorsOf, type ApiInput } from '@/lib/api'
import { API_SLUG_MAX, validateApiSlug } from '@/lib/api-slug'
import type { Api, FeedType, Organization } from '@/lib/api-types'
import { FEED_TYPES } from '@/lib/feed-types'
import { formatNumber } from '@/lib/format'
import { normalizeSlugInput } from '@/lib/slug'
import { useRequest } from '@/lib/use-request'
import { compactErrors } from '@/lib/validation'
import { cn } from '@/lib/utils'

// "Edit" on the API page: name, slug, feed type, data. Changes apply at once (decided
// 2026-10-11); a new slug moves the page to the new address.
export function EditApiDialog({
  open,
  onOpenChange,
  organization,
  api,
  onSaved,
  returnFocusTo,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organization: Organization
  api: Api
  onSaved: () => Promise<void> | void
  returnFocusTo?: RefObject<HTMLElement | null> // where keyboard focus goes back when it closes
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90svh] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          if (returnFocusTo?.current?.isConnected) {
            event.preventDefault()
            returnFocusTo.current.focus()
          }
        }}
      >
        {/* The form only exists while the dialog is open: every opening starts from the saved values. */}
        <EditApiForm organization={organization} api={api} onClose={() => onOpenChange(false)} onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  )
}

function EditApiForm({
  organization,
  api,
  onClose,
  onSaved,
}: {
  organization: Organization
  api: Api
  onClose: () => void
  onSaved: () => Promise<void> | void
}) {
  const brandSlug = organization.slug
  const navigate = useNavigate()
  const dataSources = useRequest(`data-sources:${brandSlug}`, () =>
    dataSourcesApi.list(brandSlug).then((res) => res.dataSources),
  )
  const [name, setName] = useState(api.name)
  const [slug, setSlug] = useState(api.slug)
  const [feedType, setFeedType] = useState<FeedType>(api.feedType)
  const [dataSourceId, setDataSourceId] = useState(api.dataSource.id)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const published = api.status === 'published'
  const slugChanged = slug.trim() !== api.slug
  const newData = dataSourceId !== api.dataSource.id ? dataSources.data?.find((ds) => ds.id === dataSourceId) : undefined

  function clearError(field: string) {
    setErrors(({ [field]: _removed, ...rest }) => rest)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (savingRef.current) return
    const trimmedName = name.trim()
    const found = compactErrors({
      name: !trimmedName ? 'Name is required' : trimmedName.length > 100 ? 'Name must be at most 100 characters' : undefined,
      slug: validateApiSlug(slug),
    })
    setErrors(found)
    if (Object.keys(found).length > 0) return

    // Send only what changed (the backend changes only those fields).
    const changes: Partial<ApiInput> = {}
    if (trimmedName !== api.name) changes.name = trimmedName
    if (slugChanged) changes.slug = slug.trim()
    if (feedType !== api.feedType) changes.feedType = feedType
    if (dataSourceId !== api.dataSource.id) changes.dataSourceId = dataSourceId
    if (Object.keys(changes).length === 0) return onClose()

    savingRef.current = true
    setSaving(true)
    try {
      const { api: saved, warnings } = await apisApi.update(brandSlug, api.slug, changes)
      toast.success('Changes saved')
      for (const warning of warnings) toast.warning(warning, { duration: 10_000 })
      onClose()
      if (saved.slug !== api.slug) {
        // The address changed: show the same tab at the new address (replace: the old one is gone).
        const tab = /\/(data|design)$/.exec(window.location.pathname)?.[0] ?? ''
        // apiRenamed: the Design tab doesn't ask "leave without saving?" for its own rename.
        navigate(`/brands/${brandSlug}/apis/${saved.slug}${tab}`, { replace: true, state: { apiRenamed: true } })
      } else {
        await onSaved()
      }
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (error.code === 'API_SLUG_TAKEN') setErrors({ slug: 'This brand already has an API with this slug. Choose another one.' })
      else if (error.code === 'API_PUBLISHED') setErrors({ feedType: error.message })
      else if (error.code === 'DATA_SOURCE_NOT_FOUND') {
        setErrors({ dataSourceId: 'That data was just deleted. Choose other data.' })
        void dataSources.refresh()
      } else if (error.code === 'DATA_MISSING_COLUMNS') {
        // The design sends columns the chosen data doesn't have (task 3.6 guard).
        setErrors({ dataSourceId: `${error.message} ${error.details.map((d) => d.message).join(' ')}` })
      } else if (error.code === 'VALIDATION_ERROR') setErrors(fieldErrorsOf(error))
      else if (error.code === 'API_NOT_FOUND') {
        toast.error('This API was deleted in the meantime.')
        onClose()
        navigate(`/brands/${brandSlug}`, { replace: true })
      } else toast.error(error.message)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} noValidate className="grid grid-cols-1 gap-5">
      <DialogHeader>
        <DialogTitle>Edit API</DialogTitle>
        <DialogDescription>Changes apply right away.</DialogDescription>
      </DialogHeader>

      <FormField id="edit-name" label="Name" error={errors.name}>
        {(field) => (
          <Input
            {...field}
            maxLength={120}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              clearError('name')
            }}
          />
        )}
      </FormField>

      <div className="grid grid-cols-1 gap-2">
        <FormField
          id="edit-slug"
          label="Slug"
          error={errors.slug}
          hint={`Lowercase letters, numbers and hyphens, up to ${API_SLUG_MAX} characters.`}
        >
          {(field) => (
            <Input
              {...field}
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              maxLength={API_SLUG_MAX + 10}
              value={slug}
              onChange={(event) => {
                setSlug(normalizeSlugInput(event.target.value))
                clearError('slug')
              }}
            />
          )}
        </FormField>
        {slugChanged && !errors.slug && (
          <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-all">
              New address /v1/{brandSlug}/{slug.trim() || '…'}. The old address stops working at once
              {published ? '; Jivox needs a new contract.' : '.'}
            </span>
          </p>
        )}
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Feed type</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Feed type">
          {FEED_TYPES.map(({ value, label, icon: Icon, tone }) => {
            const selected = feedType === value
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={label}
                disabled={published}
                onClick={() => {
                  setFeedType(value)
                  clearError('feedType')
                }}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition-colors outline-none focus-visible:ring-4 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60',
                  selected ? 'border-primary bg-primary/5 font-medium ring-1 ring-primary' : 'hover:border-primary/40',
                )}
              >
                <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-md', tone)}>
                  <Icon className="size-3.5" aria-hidden="true" />
                </span>
                {label}
              </button>
            )
          })}
        </div>
        {errors.feedType ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {errors.feedType}
          </p>
        ) : (
          published && <p className="mt-2 text-xs text-muted-foreground">A published API keeps its feed type.</p>
        )}
      </fieldset>

      <div className="grid grid-cols-1 gap-2">
        <label htmlFor="edit-data" className="text-sm font-medium">
          Data
        </label>
        <div className="relative">
          <select
            id="edit-data"
            value={dataSourceId}
            disabled={!dataSources.data}
            aria-invalid={Boolean(errors.dataSourceId)}
            onChange={(event) => {
              setDataSourceId(event.target.value)
              clearError('dataSourceId')
            }}
            className="h-9 w-full cursor-pointer appearance-none truncate rounded-lg border border-input bg-transparent py-1 pr-9 pl-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive disabled:opacity-60 dark:bg-input/30 dark:[color-scheme:dark]"
          >
            {/* Until the list loads, show the current data so the field is never empty. */}
            {!dataSources.data && <option value={api.dataSource.id}>{api.dataSource.name}</option>}
            {dataSources.data?.map((ds) => (
              <option key={ds.id} value={ds.id}>
                {ds.name} · {ds.hasData ? `${formatNumber(ds.rowCount)} rows` : 'no data yet'} · id {ds.idColumn}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        </div>
        {errors.dataSourceId ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.dataSourceId}
          </p>
        ) : newData ? (
          <p className="text-xs text-muted-foreground">
            This API will answer from <span className="font-medium text-foreground">{newData.name}</span> (id column{' '}
            <span className="font-mono">{newData.idColumn}</span>){published && '; Jivox needs a new contract'}.
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </form>
  )
}
