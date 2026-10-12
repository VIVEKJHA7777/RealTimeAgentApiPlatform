import { ChevronDown, ChevronRight, Loader2, ToggleRight } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { agentsApi, ApiError, designApi, switchesApi } from '@/lib/api'
import type { ActiveSwitch, Api, SwitchCatalogueEntry, SwitchKind } from '@/lib/api-types'
import { switchName } from '@/lib/logs'
import {
  clockLabel,
  DEFAULT_MINUTES,
  DURATIONS,
  endsIn,
  HTTP_STATUSES,
  optionsFor,
  scopeChoices,
  scopeLabel,
  SLOW_DEFAULT_MS,
  SLOW_PRESETS,
  slowProblem,
  SWITCH_GROUPS,
  SWITCHES_CARD_ID,
} from '@/lib/switches'
import { useRememberedOpen } from '@/lib/use-remembered-open'
import { useRequest } from '@/lib/use-request'
import type { SwitchesHandle } from '@/lib/use-switches'
import { useTokens } from '@/lib/use-tokens'
import { cn } from '@/lib/utils'

// The Test tab's "Test switches" card (task 7.6, mockup approved 2026-10-12): the 12 switches in
// groups, each saying what /v1 then does and what Jivox should report. "Turn on…" opens a small form
// in place (options, who gets it, 15 min / 1 h / 4 h, our own checks); a switch that's on shows for
// whom and until when, with Change and Turn off. Shares its state with the page's red banner.
export function SwitchesCard({ brandSlug, api, switches }: { brandSlug: string; api: Api; switches: SwitchesHandle }) {
  const [editing, setEditing] = useState<SwitchKind | null>(null)
  const [allOffBusy, setAllOffBusy] = useState(false)
  const heading = useRef<HTMLButtonElement>(null) // the open / close button inside the heading
  // Closed until the person opens it; their choice is remembered in this browser (like the checklist).
  const [open, setOpen] = useRememberedOpen('test.switches.open', false)
  const tokens = useTokens(brandSlug, api.slug)
  const agents = useRequest(`agents:${brandSlug}/${api.slug}`, () => agentsApi.list(brandSlug, api.slug))
  const choices = scopeChoices(
    (tokens.data?.tokens ?? []).map((t) => ({ id: t.id, name: t.name, revokedAt: t.revokedAt })),
    agents.data?.agents ?? [],
  )

  // The banner's "Manage" lands here (…/test#test-switches).
  const { hash } = useLocation()
  // "Manage" always opens the card (it's what the person came for).
  useEffect(() => {
    if (hash !== `#${SWITCHES_CARD_ID}` || !switches.state) return
    setOpen(true)
    heading.current?.closest('section')?.scrollIntoView({ block: 'start' }) // the card keeps a margin under the top bar
    heading.current?.focus({ preventScroll: true })
  }, [hash, switches.state === null]) // eslint-disable-line react-hooks/exhaustive-deps

  async function allOff() {
    setAllOffBusy(true)
    try {
      const next = await switchesApi.off(brandSlug, api.slug)
      switches.apply(next)
      setEditing(null)
      toast.success(`${next.turnedOff ?? 0} test switch${next.turnedOff === 1 ? '' : 'es'} turned off`)
      heading.current?.focus()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't turn the switches off")
    } finally {
      setAllOffBusy(false)
    }
  }

  const bodyId = 'test-switches-list'
  const catalogue = new Map((switches.state?.catalogue ?? []).map((c) => [c.kind, c]))
  const onCount = switches.on.length

  return (
    <section id={SWITCHES_CARD_ID} aria-labelledby="switches-heading" className="@container scroll-mt-20 rounded-2xl border bg-background">
      <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4', open && 'border-b')}>
        <div className="min-w-60 flex-1">
          {/* A disclosure: the button inside the heading opens / closes the list of switches. */}
          <h2 id="switches-heading" className="font-semibold">
            <button
              ref={heading}
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-controls={bodyId}
              className="flex items-center gap-2 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {open ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <ToggleRight className="size-4 text-muted-foreground" aria-hidden="true" />
              Test switches
              {onCount > 0 && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">{onCount} on</span>}
            </button>
          </h2>
          <p className="text-sm text-muted-foreground">
            Make the live URL answer wrongly on purpose, one mistake per switch, to check that Jivox catches it. Each ends by itself. The contract is never affected.
          </p>
          {/* Closed: what's on, so nobody has to open it just to check. */}
          {!open && switches.state && (
            <ul className="mt-2 grid gap-0.5 text-xs" aria-label="Switches on">
              {onCount === 0 ? (
                <li className="text-muted-foreground">None on: the live URL answers normally. Open to turn one on.</li>
              ) : (
                switches.on.map((sw) => (
                  <li key={sw.kind} className="text-destructive">
                    ● {switchName(sw.kind, sw.options)} · {scopeLabel(sw)}
                    {sw.applyToOwnChecks && ' · our own checks too'} · ends {clockLabel(sw.endsAt, switches.now)} ({endsIn(sw.endsAt, switches.now)})
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
        {onCount > 0 && (
          <Button size="sm" variant="outline" onClick={() => void allOff()} disabled={allOffBusy}>
            {allOffBusy && <Loader2 className="animate-spin" />}
            Turn all off
          </Button>
        )}
      </div>

      {!open ? null : !switches.state ? (
        switches.error ? (
          <div role="alert" className="flex flex-col items-start gap-2 p-5 text-sm">
            <p>{switches.error.message}</p>
            <Button size="sm" variant="outline" onClick={() => void switches.refresh()}>
              Try again
            </Button>
          </div>
        ) : (
          <p className="p-5 text-sm text-muted-foreground">Loading the switches…</p>
        )
      ) : (
        <div id={bodyId} className="grid gap-1 p-2 @lg:p-3">
          {SWITCH_GROUPS.map((group) => (
            <div key={group.title} role="group" aria-label={group.title}>
              <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">{group.title}</p>
              <ul className="grid gap-1">
                {group.kinds.map((kind) => {
                  const entry = catalogue.get(kind)
                  if (!entry) return null
                  return (
                    <SwitchRow
                      key={kind}
                      brandSlug={brandSlug}
                      api={api}
                      entry={entry}
                      active={switches.on.find((s) => s.kind === kind) ?? null}
                      now={switches.now}
                      editing={editing === kind}
                      onEdit={(open) => setEditing(open ? kind : null)}
                      choices={choices}
                      switches={switches}
                    />
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function SwitchRow({
  brandSlug,
  api,
  entry,
  active,
  now,
  editing,
  onEdit,
  choices,
  switches,
}: {
  brandSlug: string
  api: Api
  entry: SwitchCatalogueEntry
  active: ActiveSwitch | null
  now: number
  editing: boolean
  onEdit: (open: boolean) => void
  choices: { value: string; label: string }[]
  switches: SwitchesHandle
}) {
  const [busy, setBusy] = useState(false)
  const formId = useId()
  const openButton = useRef<HTMLButtonElement>(null)
  // After on / change / off the pressed button is gone: focus goes to the row's new first button,
  // once the row has re-drawn (an effect after every render, not in the same tick).
  const refocus = useRef(false)
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    openButton.current?.focus()
  })

  async function turnOff() {
    setBusy(true)
    try {
      switches.apply(await switchesApi.off(brandSlug, api.slug, entry.kind))
      onEdit(false)
      toast.success(`${entry.label} turned off`)
      refocus.current = true
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Couldn't turn ${entry.label} off`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={cn('rounded-lg', active ? 'bg-destructive/5 ring-1 ring-destructive/20' : editing && 'bg-muted/50')} data-switch={entry.kind}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <div className="min-w-0 flex-1 basis-64">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
            {active ? switchName(entry.kind, active.options) : entry.label}
            {active && (
              <span className="text-xs font-normal text-destructive">
                ● on · {scopeLabel(active)}
                {active.applyToOwnChecks && ' · our own checks too'} · ends {clockLabel(active.endsAt, now)} ({endsIn(active.endsAt, now)})
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {entry.does}. Jivox should report: <span className="text-foreground">{entry.jivoxShould}</span>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {active ? (
            <>
              <Button ref={openButton} size="sm" variant="outline" aria-expanded={editing} aria-controls={formId} onClick={() => onEdit(!editing)}>
                Change
              </Button>
              <Button size="sm" variant="outline" onClick={() => void turnOff()} disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                Turn off
              </Button>
            </>
          ) : (
            <Button ref={openButton} size="sm" variant="outline" aria-expanded={editing} aria-controls={formId} onClick={() => onEdit(!editing)}>
              Turn on…
            </Button>
          )}
        </div>
      </div>
      {editing && (
        <SwitchForm
          id={formId}
          brandSlug={brandSlug}
          api={api}
          entry={entry}
          active={active}
          choices={choices}
          onDone={(message) => {
            onEdit(false)
            if (message) toast.success(message)
            refocus.current = true
          }}
          switches={switches}
        />
      )}
    </li>
  )
}

function SwitchForm({
  id,
  brandSlug,
  api,
  entry,
  active,
  choices,
  onDone,
  switches,
}: {
  id: string
  brandSlug: string
  api: Api
  entry: SwitchCatalogueEntry
  active: ActiveSwitch | null
  choices: { value: string; label: string }[]
  onDone: (message: string | null) => void
  switches: SwitchesHandle
}) {
  const kind = entry.kind
  const [scope, setScope] = useState(active?.scope?.tokenId ?? 'all')
  const [minutes, setMinutes] = useState<number>(DEFAULT_MINUTES)
  const [own, setOwn] = useState(active?.applyToOwnChecks ?? false)
  const [field, setField] = useState(String(active?.options.field ?? ''))
  const [msText, setMsText] = useState(String(active?.options.ms ?? SLOW_DEFAULT_MS))
  const [status, setStatus] = useState(Number(active?.options.status ?? 500))
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const firstControl = useRef<HTMLElement | null>(null)
  // Only "Wrong type" needs the answer's fields (the design's response keys, not the id).
  const design = useRequest(kind === 'wrong_type' ? `design:${brandSlug}/${api.slug}` : 'none', () =>
    kind === 'wrong_type' ? designApi.get(brandSlug, api.slug) : Promise.resolve(null),
  )
  const fields = design.data?.design.fields.map((f) => f.responseKey) ?? []
  const msProblem = kind === 'slow' ? slowProblem(msText) : null
  // A scope that isn't offered any more (its token revoked): back to "every caller" would surprise; say so.
  const scopeKnown = choices.some((c) => c.value === scope)

  useEffect(() => {
    firstControl.current?.focus()
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (kind === 'wrong_type' && !field) return setProblem('Choose the field to send with the wrong type.')
    if (msProblem) return setProblem(`Wait (ms): ${msProblem.charAt(0).toLowerCase()}${msProblem.slice(1)}.`)
    if (!scopeKnown) return setProblem('Choose who gets it: the token it was aimed at is no longer active.')
    setSaving(true)
    setProblem(null)
    try {
      const next = await switchesApi.set(brandSlug, api.slug, kind, {
        options: optionsFor(kind, { field, ms: Number(msText), status }),
        tokenId: scope === 'all' ? null : scope,
        minutes,
        applyToOwnChecks: own,
      })
      switches.apply(next)
      const now = next.switches.find((s) => s.kind === kind)
      onDone(now ? `${switchName(kind, now.options)} ${active ? 'changed' : 'on'} for ${scopeLabel(now)} until ${clockLabel(now.endsAt)}` : null)
    } catch (err) {
      if (err instanceof ApiError) setProblem([err.message, ...(err.details ?? []).map((d) => d.message)].filter((v, i, a) => a.indexOf(v) === i).join(' · '))
      else setProblem("Couldn't save. Try again.")
    } finally {
      setSaving(false)
    }
  }

  const label = 'grid gap-1 text-xs text-muted-foreground'
  return (
    <form id={id} onSubmit={(e) => void submit(e)} className="grid gap-3 border-t px-3 py-3" aria-label={`${active ? 'Change' : 'Turn on'} ${entry.label}`}>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        {kind === 'wrong_type' && (
          <label className={label}>
            Field
            <Select value={field || undefined} onValueChange={setField}>
              <SelectTrigger size="sm" className="w-44 text-xs" ref={(el) => void (firstControl.current ??= el)} aria-label="Field sent with the wrong type">
                <SelectValue placeholder={design.loading ? 'Loading…' : 'Choose a field'} />
              </SelectTrigger>
              <SelectContent>
                {fields.map((f) => (
                  <SelectItem key={f} value={f} className="font-mono text-xs">
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}
        {kind === 'slow' && (
          <label className={label}>
            Wait (ms)
            <span className="flex items-center gap-1.5">
              <Input
                ref={(el) => void (firstControl.current ??= el)}
                value={msText}
                onChange={(e) => setMsText(e.target.value)}
                inputMode="numeric"
                aria-invalid={msProblem !== null}
                className="h-8 w-24 text-xs"
              />
              {SLOW_PRESETS.map((ms) => (
                <Button key={ms} type="button" size="xs" variant={Number(msText) === ms ? 'secondary' : 'ghost'} onClick={() => setMsText(String(ms))}>
                  {ms / 1000} s
                </Button>
              ))}
            </span>
          </label>
        )}
        {kind === 'http_status' && (
          <label className={label}>
            HTTP status
            <Select value={String(status)} onValueChange={(v) => setStatus(Number(v))}>
              <SelectTrigger size="sm" className="w-28 text-xs" ref={(el) => void (firstControl.current ??= el)} aria-label="HTTP status to answer with">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HTTP_STATUSES.map((s) => (
                  <SelectItem key={s} value={String(s)} className="text-xs">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}
        <label className={label}>
          Who gets it
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger size="sm" className="w-56 max-w-full text-xs" ref={(el) => void (firstControl.current ??= el)} aria-label="Who gets it">
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent>
              {choices.map((c) => (
                <SelectItem key={c.value} value={c.value} className="text-xs">
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <fieldset className={label}>
          <legend className="mb-1">For{active && ' (counts from now)'}</legend>
          <span className="flex gap-1">
            {DURATIONS.map((d) => (
              <Button key={d.minutes} type="button" size="sm" variant={minutes === d.minutes ? 'secondary' : 'outline'} aria-pressed={minutes === d.minutes} onClick={() => setMinutes(d.minutes)} className="h-8 text-xs">
                {d.label}
              </Button>
            ))}
          </span>
        </fieldset>
        <label className="flex items-center gap-2 pb-1.5 text-xs">
          <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} className="size-4 accent-primary" />
          Also our own checks (self-check, checklist, Try it)
        </label>
      </div>
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving || (kind === 'wrong_type' && fields.length === 0 && !design.loading)}>
          {saving && <Loader2 className="animate-spin" />}
          {active ? 'Save' : 'Turn on'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
      {kind === 'wrong_type' && !design.loading && fields.length === 0 && <p className="text-xs text-muted-foreground">This API has no fields yet: design it first.</p>}
    </form>
  )
}
