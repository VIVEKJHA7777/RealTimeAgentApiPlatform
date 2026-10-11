import { AlertTriangle, CircleCheck, FileSpreadsheet, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useApiPage } from '@/components/apis/api-page/context'
import { EmptyState, ErrorState } from '@/components/PageStates'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, designApi, jivoxApi } from '@/lib/api'
import type { ColumnInfo, DesignState, DroppedAgentFields } from '@/lib/api-types'
import { type Draft, draftFromState, sameDesign, toInput } from '@/lib/design'
import { feedTypeInfo } from '@/lib/feed-types'
import { formatNumber } from '@/lib/format'
import { useDesignPreview, useValueChecks } from '@/lib/use-design-checks'
import { useRequest } from '@/lib/use-request'
import { PreviewPanel } from './PreviewPanel'
import { RequestEditor } from './RequestEditor'
import { ResponseFields } from './ResponseFields'

// "/brands/:slug/apis/:apiSlug/design" (task 3.7): what the API sends and how Jivox calls it.
// Loads the saved design, the Jivox field list of the feed type and the data's column types;
// edits a local draft; previews it live; saves it with the version check (409 = someone saved).
export function DesignTab() {
  const { organization, api, dataSource, refresh } = useApiPage()
  const brandSlug = organization.slug
  const navigate = useNavigate()

  // Reloaded when the API's feed type / data change (Edit API) or it's renamed.
  const design = useRequest(`design:${brandSlug}/${api.slug}/${api.feedType}/${api.dataSource.id}`, () =>
    designApi.get(brandSlug, api.slug),
  )
  const schema = useRequest(`feed-schema:${api.feedType}`, () => jivoxApi.feedSchema(api.feedType).then((r) => r.feedSchema))
  // Column types change with every new version of the data.
  const dataKey = `${api.dataSource.id}:${dataSource.lastImportAt ?? 'none'}`
  const columnTypes = useRequest(`design-columns:${brandSlug}/${api.slug}/${dataKey}`, () => designApi.columns(brandSlug, api.slug), {
    keepPreviousData: true,
  })

  // The draft being edited, and the saved design it started from ("unsaved changes" = they differ).
  const [draft, setDraft] = useState<Draft | null>(null)
  const [base, setBase] = useState<{ state: DesignState; draft: Draft } | null>(null)
  const [loadedFrom, setLoadedFrom] = useState<DesignState | undefined>(undefined)
  // The API the draft belongs to: a draft never carries over to ANOTHER API.
  const [draftFor, setDraftFor] = useState(api.id)
  if (api.id !== draftFor) {
    setDraftFor(api.id)
    setDraft(null)
    setBase(null)
    setLoadedFrom(undefined)
  }
  const dirty = draft !== null && base !== null && !sameDesign(draft, base.draft)
  if (design.data && design.data !== loadedFrom) {
    // A (re)load: start editing it, unless there are unsaved changes (kept; their problems
    // show against the new data / feed type).
    setLoadedFrom(design.data)
    const fresh = draftFromState(design.data)
    setBase({ state: design.data, draft: fresh })
    if (!dirty) setDraft(fresh)
  }

  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [jsonInvalid, setJsonInvalid] = useState(false)
  const [editorKey, setEditorKey] = useState(0) // remounts the request editor after discard / reload
  const [ids, setIds] = useState('')
  const saveRef = useRef<HTMLButtonElement>(null) // focus lands here after "Stay"
  const phoneSaveRef = useRef<HTMLButtonElement>(null) // the phone's bottom bar
  // After a dialog opened by saving (not by a button it could return to): back to the visible Save.
  const focusSave = (event: Event) => {
    const visible = [saveRef.current, phoneSaveRef.current].find((b) => b && b.offsetParent !== null)
    if (!visible) return
    event.preventDefault()
    visible.focus()
  }
  // 5.6: a save that takes fields away from Jivox agents (409 AGENT_FIELDS_DROPPED) waits here
  // for "Save anyway"; the server asks again if the list changed meanwhile.
  const [dropped, setDropped] = useState<DroppedAgentFields[] | null>(null)

  const input = draft ? toInput(draft) : { idField: { responseKey: '' }, fields: [], request: undefined }
  const idList = ids.split(',').map((id) => id.trim()).filter(Boolean)
  const preview = useDesignPreview(brandSlug, api.slug, input, idList, `${api.feedType}|${dataKey}`, draft !== null)
  const checkFor = useValueChecks(
    brandSlug,
    api.slug,
    (draft?.fields ?? []).filter((f) => f.sourceColumn && dataSource.columns.includes(f.sourceColumn)),
    dataKey,
  )

  // Problems of the CURRENT draft come from the live preview (same checks as a save); before
  // the first preview answer, the ones the saved design has against today's data.
  const problems =
    preview.state?.status === 'invalid' ? preview.state.problems : preview.state ? [] : (base?.state.problems ?? [])

  // Leaving with unsaved changes: in-app links ask first (a rename keeps you here), and the
  // browser asks on reload / close.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      currentLocation.pathname !== nextLocation.pathname &&
      !(nextLocation.state as { apiRenamed?: boolean } | null)?.apiRenamed,
  )
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  async function save(confirmed?: DroppedAgentFields[]) {
    if (!draft || !base || saving) return
    if (jsonInvalid) {
      toast.error('The request JSON isn’t valid. Fix it before saving.')
      return
    }
    setSaving(true)
    try {
      const confirmDroppedFields = (confirmed ?? []).flatMap((a) => a.fields.map((field) => ({ agentId: a.id, field })))
      const state = await designApi.save(brandSlug, api.slug, { ...toInput(draft), version: base.state.design.version, confirmDroppedFields })
      setDropped(null)
      // Keep the rows' ids so nothing re-mounts (focus stays where it was).
      const fresh = draftFromState(state)
      fresh.fields = fresh.fields.map((f, i) => ({ ...f, uid: draft.fields[i]?.uid ?? f.uid }))
      setBase({ state, draft: fresh })
      setDraft(fresh)
      toast.success(`Design saved (version ${state.design.version})`)
      for (const warning of state.warnings.filter((w) => w.includes('published'))) toast.warning(warning, { duration: 10_000 })
      const changed = state.agentImpact?.changed ?? []
      if (changed.length > 0) {
        toast.warning(
          `This save changed the contract of ${changed.length === 1 ? changed[0].name : `${changed.length} Jivox agents (${changed.map((a) => a.name).join(', ')})`}. Copy the new one from the Jivox tab.`,
          { duration: 12_000, action: { label: 'Open Jivox tab', onClick: () => navigate(`/brands/${brandSlug}/apis/${api.slug}/jivox`) } },
        )
      }
      void refresh() // the Overview's "Design the response" step
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      if (err.code === 'DESIGN_INVALID') {
        toast.error(`Fix ${err.details.length} ${err.details.length === 1 ? 'problem' : 'problems'} before saving.`)
        preview.reload()
      } else if (err.code === 'DESIGN_CHANGED') {
        setDropped(null)
        setConflict(true)
      } else if (err.code === 'AGENT_FIELDS_DROPPED') {
        setDropped((err.extra?.agents as DroppedAgentFields[] | undefined) ?? [])
      } else if (err.code === 'API_NOT_FOUND') {
        toast.error('This API was deleted in the meantime.')
        navigate(`/brands/${brandSlug}`, { replace: true })
      } else {
        toast.error(err.message)
      }
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    if (!base) return
    setDraft(base.draft)
    setJsonInvalid(false)
    setEditorKey((n) => n + 1)
  }

  function reloadLatest() {
    setConflict(false)
    setDraft(null)
    setBase(null)
    setJsonInvalid(false)
    setEditorKey((n) => n + 1)
    design.reload()
  }

  async function copyMine() {
    if (!draft) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(toInput(draft), null, 2))
      toast.success('Your version is on the clipboard')
    } catch {
      toast.error("Couldn't copy. Your changes stay in this tab until you reload.")
    }
  }

  // ── states ──
  // 5.6: Jivox field → the agents using it (as of the last load / save)
  const agentUse = new Map<string, string[]>()
  for (const a of base?.state.agents ?? []) for (const f of a.fields) agentUse.set(f, [...(agentUse.get(f) ?? []), a.name])

  if (dataSource.columns.length === 0) {
    return (
      <EmptyState
        icon={FileSpreadsheet}
        title="Upload data first"
        description="The design maps your data's columns to Jivox fields. This API's data has no columns yet."
        action={
          <Button asChild variant="outline">
            <Link to="../data" relative="path">
              Open the Data tab
            </Link>
          </Button>
        }
      />
    )
  }
  const loadError = design.error ?? schema.error ?? (columnTypes.data ? undefined : columnTypes.error)
  if (loadError && !draft) {
    return (
      <ErrorState
        message={loadError.message}
        onRetry={() => {
          design.reload()
          schema.reload()
          columnTypes.reload()
        }}
      />
    )
  }
  if (!draft || !base || !schema.data) return <DesignSkeleton />

  const info = new Map<string, ColumnInfo>((columnTypes.data?.columns ?? []).map((c) => [c.name, c]))
  const savedVersion = base.state.design.version

  return (
    <div className="@container/design flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">What your API sends</h2>
          <p className="text-sm text-muted-foreground">
            {feedTypeInfo(api.feedType).label} feed · from “{dataSource.name}” ({formatNumber(dataSource.rowCount)} rows) ·{' '}
            {base.state.design.saved ? `version ${savedVersion}` : 'not saved yet'}
          </p>
        </div>
        <SaveState dirty={dirty} saving={saving} saved={base.state.design.saved} problems={problems.length} />
        <div className="hidden gap-2 sm:flex">
          {dirty && (
            <Button type="button" variant="outline" onClick={discard} disabled={saving}>
              Discard
            </Button>
          )}
          <Button ref={saveRef} type="button" onClick={() => void save()} disabled={saving || (!dirty && base.state.design.saved)}>
            {saving && <Loader2 className="animate-spin" />}
            Save design
          </Button>
        </div>
      </div>

      {api.status === 'published' && (
        <p className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          This API is published. Saving changes what Jivox receives right away; generate and activate a new contract afterwards.
        </p>
      )}

      <div className="grid grid-cols-1 items-start gap-6 @min-[68rem]/design:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <ResponseFields
            draft={draft}
            onChange={setDraft}
            schema={schema.data}
            columns={dataSource.columns}
            info={info}
            idColumn={dataSource.idColumn}
            problems={problems}
            checkFor={checkFor}
            agentUse={agentUse}
          />
          <RequestEditor
            key={editorKey}
            request={draft.request}
            onChange={(request) => setDraft({ ...draft, request })}
            schema={schema.data}
            problems={problems}
            onJsonInvalid={setJsonInvalid}
          />
        </div>
        <PreviewPanel
          className="@min-[68rem]/design:sticky @min-[68rem]/design:top-4"
          state={preview.state}
          loading={preview.loading}
          ids={ids}
          onIdsChange={setIds}
          onReload={preview.reload}
          exampleIds={info.get(dataSource.idColumn)?.examples.slice(0, 2) ?? []}
        />
      </div>

      {/* Phones: the save bar stays at the bottom of the screen. */}
      <div className="sticky bottom-0 -mx-4 flex items-center gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:hidden">
        <span className="flex-1 text-sm text-muted-foreground">{dirty ? 'Unsaved changes' : base.state.design.saved ? 'Saved' : 'Not saved yet'}</span>
        {dirty && (
          <Button type="button" variant="outline" size="sm" onClick={discard} disabled={saving}>
            Discard
          </Button>
        )}
        <Button ref={phoneSaveRef} type="button" size="sm" onClick={() => void save()} disabled={saving || (!dirty && base.state.design.saved)}>
          {saving && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </div>

      <AlertDialog open={dropped !== null} onOpenChange={(open) => !open && setDropped(null)}>
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" onCloseAutoFocus={focusSave}>
          <AlertDialogHeader>
            <AlertDialogTitle>Jivox agents lose fields</AlertDialogTitle>
            <AlertDialogDescription>
              This change takes fields out of the design that these agents' contracts answer live. The API changes as soon as you save; until the
              fields are back (or the agents no longer use them), their contract checks show what's missing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="-mx-1 grid max-h-[min(40dvh,20rem)] gap-2 overflow-y-auto px-1 text-sm" aria-label="Agents that lose fields" tabIndex={0}>
            {(dropped ?? []).map((a) => (
              <li key={a.id} className="rounded-lg border px-3 py-2">
                <p className="font-medium break-words">{a.name}</p>
                <p className="text-muted-foreground">
                  Loses <span className="font-mono text-foreground">{a.fields.join(', ')}</span>
                  {a.left === 0 ? (
                    <span className="text-destructive">: no fields left, so no contract can be made for it.</span>
                  ) : (
                    `; keeps ${a.left} field${a.left === 1 ? '' : 's'}.`
                  )}
                </p>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void save(dropped ?? [])
              }}
              disabled={saving}
            >
              {saving && <Loader2 className="animate-spin" />}
              Save anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={conflict} onOpenChange={setConflict}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This design changed</AlertDialogTitle>
            <AlertDialogDescription>
              Someone saved a newer version after you opened it. Reload to see their changes; yours stay in this tab until you do. Copy
              yours first if you want to keep them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button type="button" variant="outline" onClick={copyMine}>
              Copy my version
            </Button>
            <AlertDialogAction onClick={reloadLatest}>Reload latest</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={blocker.state === 'blocked'} onOpenChange={(open) => !open && blocker.reset?.()}>
        <AlertDialogContent
          // No trigger button to return to: "Stay" leads to the next step, saving.
          onCloseAutoFocus={focusSave}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>Your design changes aren't saved. If you leave now, they're lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Stay</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SaveState({ dirty, saving, saved, problems }: { dirty: boolean; saving: boolean; saved: boolean; problems: number }) {
  if (saving) return <span className="text-sm text-muted-foreground">Saving…</span>
  if (problems > 0) {
    return (
      <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
        {problems} {problems === 1 ? 'problem' : 'problems'}
      </span>
    )
  }
  if (dirty) return <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">Unsaved changes</span>
  if (saved) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <CircleCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        Saved
      </span>
    )
  }
  return null
}

function DesignSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading the design">
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-72 rounded-2xl" />
      <Skeleton className="h-48 rounded-2xl" />
    </div>
  )
}
