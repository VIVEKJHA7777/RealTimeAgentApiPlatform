import { CalendarClock, ChevronRight, Ellipsis, Eye, EyeOff, KeyRound, Loader2, Pencil, Plus, RefreshCw, Ban, Copy, Check } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { toast } from 'sonner'
import { ErrorState } from '@/components/PageStates'
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, tokensApi } from '@/lib/api'
import { copyToClipboard } from '@/lib/clipboard'
import type { Api, AuthHeaderStyle, TokenInfo } from '@/lib/api-types'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { countsTowardLimit, expiryLook, headerExample, maskedToken, type ExpiryLook } from '@/lib/tokens'
import type { TokensRequest } from '@/lib/use-tokens'
import { cn } from '@/lib/utils'
import { ExtendTokenDialog, NewTokenDialog, RenameTokenDialog, RenewTokenDialog, RevokeTokenDialog } from './TokenDialogs'

const HIDE_AFTER_MS = 60_000 // a shown token hides itself again after a minute

type Action = 'rename' | 'extend' | 'renew' | 'revoke'
type OpenDialog = { kind: 'new' } | { kind: Action; token: TokenInfo } | null

// The Tokens card (task 4.6, mockup 2 approved 2026-10-11): what Jivox sends to call this API.
// Tokens can be shown / copied any time (P4-1), expire if you want (P4-12), and be extended,
// renewed or revoked (P4-13/14). Wide screens: rows. Phones: cards, the ⋯ menu as a bottom sheet.
// The list is loaded by the Test tab (lib/use-tokens.ts): the curl box offers the same tokens.
export function TokensCard({
  brandSlug,
  api,
  list,
  onApiChanged,
  onTokensChanged,
}: {
  brandSlug: string
  api: Api
  list: TokensRequest
  onApiChanged: () => void
  onTokensChanged: () => void // the Publish button checks again
}) {
  const [dialog, setDialog] = useState<OpenDialog>(null)
  const [sheetFor, setSheetFor] = useState<TokenInfo | null>(null)
  const [showRevoked, setShowRevoked] = useState(false)
  const shown = useShownTokens(brandSlug, api.slug, () => void list.refresh())
  const newRef = useRef<HTMLButtonElement>(null)
  // Where keyboard focus goes back after a dialog opened from a row (its ⋯ / button).
  const lastTrigger = useRef<HTMLElement | null>(null)
  const lastTokenId = useRef<string | null>(null)

  const tokens = list.data?.tokens ?? []
  const live = tokens.filter((t) => t.state !== 'revoked') // count toward the limit (= countsTowardLimit)
  const revoked = tokens.filter((t) => t.state === 'revoked')
  const max = list.data?.limits.maxTokens ?? 20
  const activeCount = tokens.filter((t) => t.state === 'active').length
  const style = list.data?.authHeader ?? api.authHeader

  function open(kind: Action, token: TokenInfo, trigger: HTMLElement | null) {
    lastTrigger.current = trigger
    lastTokenId.current = token.id
    setSheetFor(null)
    setDialog({ kind, token })
  }
  // After a dialog: back to the button that opened it. If that button is gone (Extend / Renew on an
  // expired row removes its inline buttons; revoke removes the row) → the token row's ⋯, else
  // "New token". Keyboard focus never drops to the page.
  const returnFocus = {
    get current(): HTMLElement | null {
      const trigger = lastTrigger.current
      if (trigger?.isConnected && trigger.offsetParent !== null) return trigger
      const id = lastTokenId.current
      const row = id ? document.querySelector<HTMLElement>(`[data-token-id="${id}"]`) : null
      const more = row ? [...row.querySelectorAll<HTMLElement>('button[aria-label^="Actions for"]')].find((b) => b.offsetParent !== null) : null
      return more ?? newRef.current
    },
  }
  // Reload the list. If the change removed the focused button (inline Extend on a row that is no
  // longer expired, a revoked row), focus moves somewhere sensible instead of the page. Checked
  // AFTER React drew the new list (an effect on the data), not when the request finishes.
  const refocusAfterReload = useRef(false)
  const changed = () => {
    refocusAfterReload.current = true
    void list.refresh()
    onTokensChanged()
  }
  useEffect(() => {
    if (!refocusAfterReload.current) return
    refocusAfterReload.current = false
    const active = document.activeElement
    if (!active || active === document.body || !active.isConnected) returnFocus.current?.focus()
  }, [list.data]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section aria-labelledby="tokens-heading" className="@container rounded-2xl border bg-background">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-4">
        <div className="min-w-60 flex-1">
          <h2 id="tokens-heading" className="flex items-center gap-2 font-semibold">
            <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
            Tokens
          </h2>
          <p className="text-sm text-muted-foreground">Jivox sends one with every call. Only you can see them.</p>
        </div>
        {list.data && (
          <span className="text-xs text-muted-foreground" title="Expired tokens count too (Extend can revive them)">
            {countsTowardLimit(tokens)} of {max}
          </span>
        )}
        <Button
          ref={newRef}
          size="sm"
          onClick={() => {
            if (live.length >= max) {
              toast.error(`An API can have at most ${max} tokens. Revoke one you don't use first.`)
              return
            }
            setDialog({ kind: 'new' })
          }}
          disabled={!list.data}
        >
          <Plus />
          New token
        </Button>
      </div>

      {list.loading && !list.data ? (
        <div className="grid gap-3 p-5" role="status" aria-label="Loading tokens">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : list.error && !list.data ? (
        <div className="p-5">
          <ErrorState message={list.error.message} onRetry={list.reload} />
        </div>
      ) : (
        <>
          {live.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
              <KeyRound className="size-8 text-muted-foreground/50" aria-hidden="true" />
              <p className="font-medium">{revoked.length ? 'No active tokens' : 'No tokens yet'}</p>
              <p className="max-w-sm text-sm text-balance text-muted-foreground">
                Create one for Jivox. You need at least one to publish this API.
              </p>
            </div>
          ) : (
            <>
              {/* column titles (wide only) */}
              <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1.7fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_8.5rem] gap-3 px-5 pt-3 pb-1 text-xs text-muted-foreground @2xl:grid" aria-hidden="true">
                <span>Name</span>
                <span>Token</span>
                <span>Expires</span>
                <span>Last used</span>
                <span />
              </div>
              <ul aria-label="Tokens" className="divide-y">
                {live.map((token) => (
                  <TokenRow
                    key={token.id}
                    token={token}
                    shown={shown.value(token.id)}
                    busy={shown.busy === token.id}
                    onToggle={() => shown.toggle(token)}
                    onCopy={() => shown.copy(token)}
                    onAction={(kind, trigger) => open(kind, token, trigger)}
                    onOpenSheet={(trigger) => {
                      lastTrigger.current = trigger
                      setSheetFor(token)
                    }}
                  />
                ))}
              </ul>
            </>
          )}

          {revoked.length > 0 && (
            <div className="border-t px-5 py-2">
              <button
                type="button"
                aria-expanded={showRevoked}
                aria-controls="revoked-tokens"
                onClick={() => setShowRevoked((v) => !v)}
                className="flex items-center gap-1 rounded py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <ChevronRight className={cn('size-4 transition-transform', showRevoked && 'rotate-90')} aria-hidden="true" />
                Revoked ({revoked.length})
              </button>
              {showRevoked && (
                <ul id="revoked-tokens" className="grid gap-1 pb-2 pl-5 text-sm">
                  {revoked.map((token) => {
                    const look = expiryLook(token)
                    return (
                      <li key={token.id} className="flex flex-wrap items-baseline gap-x-3 text-muted-foreground">
                        <span className="min-w-0 truncate line-through decoration-muted-foreground/40" title={token.name}>
                          {token.name}
                        </span>
                        <code className="font-mono text-xs">{maskedToken(token.hint)}</code>
                        <span className="text-xs" title={look.title}>
                          {look.text}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}

          <HeaderStyle
            brandSlug={brandSlug}
            api={api}
            style={style}
            onChanged={() => {
              changed()
              onApiChanged()
            }}
          />
        </>
      )}

      {/* phones: the row menu as a bottom sheet */}
      <Sheet open={sheetFor !== null} onOpenChange={(o) => !o && setSheetFor(null)}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
          onCloseAutoFocus={(event) => {
            if (dialog) event.preventDefault() // a dialog opened from the sheet takes focus
            else if (lastTrigger.current?.isConnected) {
              event.preventDefault()
              lastTrigger.current.focus()
            }
          }}
        >
          {sheetFor && (
            <>
              <SheetHeader>
                <SheetTitle className="truncate">{sheetFor.name}</SheetTitle>
                <SheetDescription>
                  <code className="font-mono">{maskedToken(sheetFor.hint)}</code> · {expiryLook(sheetFor).text}
                </SheetDescription>
              </SheetHeader>
              <div className="grid gap-1 px-4">
                <SheetAction icon={shown.value(sheetFor.id) ? EyeOff : Eye} onClick={() => { shown.toggle(sheetFor); setSheetFor(null) }}>
                  {shown.value(sheetFor.id) ? 'Hide' : 'Show'}
                </SheetAction>
                <SheetAction icon={Copy} onClick={() => { shown.copy(sheetFor); setSheetFor(null) }}>
                  Copy
                </SheetAction>
                <SheetAction icon={Pencil} onClick={() => open('rename', sheetFor, lastTrigger.current)}>
                  Rename
                </SheetAction>
                <SheetAction icon={CalendarClock} onClick={() => open('extend', sheetFor, lastTrigger.current)}>
                  Extend
                </SheetAction>
                <SheetAction icon={RefreshCw} onClick={() => open('renew', sheetFor, lastTrigger.current)}>
                  Renew
                </SheetAction>
                <SheetAction icon={Ban} destructive onClick={() => open('revoke', sheetFor, lastTrigger.current)}>
                  Revoke
                </SheetAction>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <NewTokenDialog
        open={dialog?.kind === 'new'}
        onOpenChange={(o) => !o && setDialog(null)}
        brandSlug={brandSlug}
        apiSlug={api.slug}
        authHeader={style}
        onChanged={changed}
        returnFocusTo={newRef}
      />
      {dialog && dialog.kind !== 'new' && (
        <ActionDialog
          dialog={dialog}
          brandSlug={brandSlug}
          apiSlug={api.slug}
          authHeader={style}
          lastActiveOfPublished={api.status === 'published' && dialog.token.state === 'active' && activeCount === 1}
          close={() => setDialog(null)}
          onChanged={() => {
            shown.forget(dialog.token.id)
            changed()
          }}
          returnFocusTo={returnFocus}
        />
      )}
    </section>
  )
}

function ActionDialog({
  dialog,
  close,
  ...common
}: {
  dialog: { kind: Action; token: TokenInfo }
  brandSlug: string
  apiSlug: string
  authHeader: AuthHeaderStyle
  lastActiveOfPublished: boolean
  close: () => void
  onChanged: () => void
  returnFocusTo: RefObject<HTMLElement | null>
}) {
  const props = { ...common, token: dialog.token, open: true, onOpenChange: (o: boolean) => !o && close() }
  if (dialog.kind === 'rename') return <RenameTokenDialog {...props} />
  if (dialog.kind === 'extend') return <ExtendTokenDialog {...props} />
  if (dialog.kind === 'renew') return <RenewTokenDialog {...props} />
  return <RevokeTokenDialog {...props} />
}

function SheetAction({ icon: Icon, destructive, onClick, children }: { icon: typeof Eye; destructive?: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
        destructive && 'text-destructive',
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {children}
    </button>
  )
}

const TONE: Record<ExpiryLook['tone'], string> = {
  muted: 'text-muted-foreground',
  normal: '',
  soon: 'rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300',
  expired: 'rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive',
  revoked: 'text-muted-foreground',
}

function TokenRow({
  token,
  shown,
  busy,
  onToggle,
  onCopy,
  onAction,
  onOpenSheet,
}: {
  token: TokenInfo
  shown: string | null
  busy: boolean
  onToggle: () => void
  onCopy: () => Promise<boolean>
  onAction: (kind: Action, trigger: HTMLElement | null) => void
  onOpenSheet: (trigger: HTMLElement) => void
}) {
  const look = expiryLook(token)
  const expired = token.state === 'expired'
  const lastUsed = token.lastUsedAt ? formatRelativeTime(token.lastUsedAt) : 'Never used'
  const moreRef = useRef<HTMLButtonElement>(null)

  return (
    <li data-token-id={token.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-5 py-3 @2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.7fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_8.5rem] @2xl:items-center">
      <span className="min-w-0 truncate text-sm font-medium" title={token.name}>
        {token.name}
      </span>
      {/* phones: ⋯ opens the bottom sheet (top-right of the card) */}
      <Button variant="ghost" size="icon-sm" className="row-span-1 @2xl:hidden" aria-label={`Actions for ${token.name}`} onClick={(e) => onOpenSheet(e.currentTarget)}>
        <Ellipsis />
      </Button>
      <TokenSecret token={token} shown={shown} busy={busy} onToggle={onToggle} onCopy={onCopy} />
      <span className="col-span-2 flex flex-wrap items-center gap-x-2 text-sm @2xl:col-span-1">
        <span className={TONE[look.tone]} title={look.title}>
          {look.text}
        </span>
        <span className="text-xs text-muted-foreground @2xl:hidden">· {lastUsed}</span>
      </span>
      <span className="hidden text-sm text-muted-foreground @2xl:block" title={token.lastUsedAt ? formatDateTime(token.lastUsedAt) : undefined}>
        {lastUsed}
      </span>
      <div className="col-span-2 flex items-center justify-end gap-1 empty:hidden @2xl:col-span-1">
        {expired && (
          <>
            <Button size="xs" variant="outline" onClick={(e) => onAction('extend', e.currentTarget)}>
              Extend
            </Button>
            <Button size="xs" variant="outline" onClick={(e) => onAction('renew', e.currentTarget)}>
              Renew
            </Button>
          </>
        )}
        <div className="hidden @2xl:block">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button ref={moreRef} variant="ghost" size="icon-sm" aria-label={`Actions for ${token.name}`}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={onToggle}>
                {shown ? <EyeOff /> : <Eye />}
                {shown ? 'Hide' : 'Show'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void onCopy()}>
                <Copy />
                Copy
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction('rename', moreRef.current)}>
                <Pencil />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction('extend', moreRef.current)}>
                <CalendarClock />
                Extend
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction('renew', moreRef.current)}>
                <RefreshCw />
                Renew
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => onAction('revoke', moreRef.current)}>
                <Ban />
                Revoke
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  )
}

// The token cell: rtk_8Hf2•••••••• with Show / Copy, or the full token while shown.
function TokenSecret({ token, shown, busy, onToggle, onCopy }: { token: TokenInfo; shown: string | null; busy: boolean; onToggle: () => void; onCopy: () => Promise<boolean> }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <span className="col-span-2 flex min-w-0 items-center gap-0.5 @2xl:col-span-1">
      <code
        className={cn('min-w-0 font-mono text-xs', shown ? 'break-all select-all' : 'truncate text-muted-foreground')}
        aria-label={shown ? `Token ${token.name}` : `Token ${token.name}, hidden`}
        data-testid="token-value"
      >
        {shown ?? maskedToken(token.hint)}
      </code>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={shown ? `Hide ${token.name}` : `Show ${token.name}`}
        title={token.canShow ? (shown ? 'Hide' : 'Show') : "Can't be shown here: renew it"}
        aria-pressed={Boolean(shown)}
        onClick={onToggle}
      >
        {busy ? <Loader2 className="animate-spin" /> : shown ? <EyeOff /> : <Eye />}
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={copied ? 'Copied' : `Copy ${token.name}`}
        title={copied ? 'Copied' : 'Copy'}
        onClick={async () => setCopied(await onCopy())}
      >
        {copied ? <Check className="text-emerald-600 dark:text-emerald-400" /> : <Copy />}
      </Button>
    </span>
  )
}

// The tokens currently shown (full text), kept ONLY in memory: never stored; hidden again after a
// minute, on Hide, when the token changes (renew / revoke), and when the page is left.
function useShownTokens(brandSlug: string, apiSlug: string, onStale: () => void) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  useEffect(() => {
    const all = timers.current
    return () => Object.values(all).forEach(clearTimeout)
  }, [])

  const forget = (id: string) => {
    clearTimeout(timers.current[id])
    setValues(({ [id]: _drop, ...rest }) => rest)
  }

  async function fetchToken(token: TokenInfo): Promise<string | null> {
    if (values[token.id]) return values[token.id]
    if (!token.canShow) {
      toast.error(`"${token.name}" still works but can't be shown (it was saved with a different encryption key). Renew it to get one you can view.`)
      return null
    }
    setBusy(token.id)
    try {
      const { token: full } = await tokensApi.reveal(brandSlug, apiSlug, token.id)
      return full
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      toast.error(err.message)
      onStale() // revoked / unreadable / gone: the list catches up
      return null
    } finally {
      setBusy(null)
    }
  }

  function remember(id: string, full: string) {
    setValues((v) => ({ ...v, [id]: full }))
    clearTimeout(timers.current[id])
    timers.current[id] = setTimeout(() => forget(id), HIDE_AFTER_MS)
  }

  return {
    busy,
    value: (id: string) => values[id] ?? null,
    forget,
    toggle: async (token: TokenInfo) => {
      if (values[token.id]) return forget(token.id)
      const full = await fetchToken(token)
      if (full) remember(token.id, full)
    },
    // Copies without showing it on screen. true = copied.
    copy: async (token: TokenInfo) => {
      const known = values[token.id]
      if (!known && !token.canShow) return Boolean(await fetchToken(token)) // explains why not
      const text = known ? Promise.resolve(known) : fetchToken(token)
      try {
        if (!(await copyToClipboard(text))) return false // fetchToken already said why
        toast.success(`"${token.name}" copied`)
        return true
      } catch {
        const t = await text.catch(() => null)
        if (!t) return false
        remember(token.id, t) // the browser refused: show it so it can be copied by hand
        toast.error("Couldn't copy. It's shown now: select it and copy it by hand.")
        return false
      }
    },
  }
}

// How Jivox sends the token (P4-4). Changing it affects the next call at once.
function HeaderStyle({ brandSlug, api, style, onChanged }: { brandSlug: string; api: Api; style: AuthHeaderStyle; onChanged: () => void }) {
  const [pending, setPending] = useState<AuthHeaderStyle | null>(null) // asking to confirm (published API)
  const [saving, setSaving] = useState<AuthHeaderStyle | null>(null)
  const current = saving ?? style

  async function save(next: AuthHeaderStyle) {
    setPending(null)
    setSaving(next)
    try {
      await tokensApi.setAuthHeader(brandSlug, api.slug, next)
      toast.success(`Jivox now sends ${headerExample(next, '<token>')}`)
      onChanged()
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      toast.error(err.message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t bg-muted/30 px-5 py-4 @2xl:flex-row @2xl:items-center @2xl:gap-5">
      <span id="header-style-label" className="shrink-0 text-sm font-medium whitespace-nowrap">
        Header Jivox sends
      </span>
      <RadioGroup
        aria-labelledby="header-style-label"
        value={current}
        onValueChange={(value) => {
          const next = value as AuthHeaderStyle
          if (next === style) return
          if (api.status === 'published') setPending(next)
          else void save(next)
        }}
        className="flex flex-wrap gap-x-5 gap-y-2"
      >
        {(['x-api-key', 'bearer'] as const).map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-2 text-sm">
            <RadioGroupItem value={option} disabled={saving !== null} />
            <span>{option === 'bearer' ? 'Bearer' : 'X-Api-Key'}</span>
          </label>
        ))}
      </RadioGroup>
      <code className="min-w-0 font-mono text-xs break-all text-muted-foreground @2xl:ml-auto @2xl:shrink-0 @2xl:break-normal @2xl:whitespace-nowrap">
        {headerExample(current)}
      </code>

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change the header of a published API?</AlertDialogTitle>
            <AlertDialogDescription>
              From the next call, only <code className="font-mono">{pending && headerExample(pending, '<token>')}</code> is accepted. If Jivox
              still sends {headerExample(style, '<token>')}, its calls fail until its contract is updated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pending && void save(pending)}>Change header</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
