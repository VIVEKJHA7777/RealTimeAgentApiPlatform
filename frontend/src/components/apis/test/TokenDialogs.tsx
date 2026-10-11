import { AlertTriangle, CircleCheck, Loader2 } from 'lucide-react'
import { useState, type FormEvent, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { toast } from 'sonner'
import { CopyButton } from '@/components/CopyButton'
import { FormField } from '@/components/forms/FormField'
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ApiError, fieldErrorsOf, tokensApi } from '@/lib/api'
import type { AuthHeaderStyle, NewToken, TokenInfo } from '@/lib/api-types'
import { expiryLook, expiryToIso, headerExample, type ExpiryChoice } from '@/lib/tokens'
import { ExpiryPicker } from './ExpiryPicker'

const NAME_MAX = 60

type Where = { brandSlug: string; apiSlug: string }
type Common = Where & {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void // reload the list
  returnFocusTo?: RefObject<HTMLElement | null>
}

// The dialog frame: the inside only exists while open (every opening starts fresh), and keyboard
// focus goes back to the button that opened it (menus open dialogs by state, not by a trigger).
function Shell({ open, onOpenChange, returnFocusTo, children }: Pick<Common, 'open' | 'onOpenChange' | 'returnFocusTo'> & { children: ReactNode }) {
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
        {open && children}
      </DialogContent>
    </Dialog>
  )
}

// Someone else (another tab / person) revoked or removed this token meanwhile: say so, close,
// reload the list. Returns true when handled.
function handledGone(error: ApiError, name: string, close: () => void, onChanged: () => void) {
  if (error.code === 'TOKEN_REVOKED' || error.code === 'TOKEN_NOT_FOUND' || error.code === 'API_NOT_FOUND') {
    toast.error(error.code === 'TOKEN_REVOKED' ? `"${name}" was revoked meanwhile (another tab?)` : error.message)
    close()
    onChanged()
    return true
  }
  return false
}

// The full token, right after it was made: copy it, with the header Jivox must send.
export function TokenShown({ token, authHeader, children }: { token: string; authHeader: AuthHeaderStyle; children?: ReactNode }) {
  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
        <code className="min-w-0 flex-1 font-mono text-sm break-all select-all" data-testid="new-token">
          {token}
        </code>
        <CopyButton value={token} label="Copy token" />
      </div>
      <p className="text-xs text-muted-foreground">
        Jivox sends it as <code className="rounded bg-muted px-1 font-mono break-all">{headerExample(authHeader, token.slice(0, 8) + '…')}</code>
      </p>
      {children}
    </div>
  )
}

function Created({ title, made, authHeader, note, onDone }: { title: string; made: NewToken; authHeader: AuthHeaderStyle; note: ReactNode; onDone: () => void }) {
  return (
    <div className="grid gap-5">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CircleCheck className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          {title}
        </DialogTitle>
        <DialogDescription>{note}</DialogDescription>
      </DialogHeader>
      <TokenShown token={made.token} authHeader={authHeader}>
        <p className="text-xs text-muted-foreground">
          {made.tokenInfo.expiresAt ? `Expires ${expiryLook(made.tokenInfo).title?.replace(/^Expires /, '') ?? ''}.` : 'Never expires.'} You can view it again later from
          this tab.
        </p>
      </TokenShown>
      <DialogFooter>
        <Button autoFocus onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  )
}

// ── New token ──
export function NewTokenDialog(props: Common & { authHeader: AuthHeaderStyle }) {
  return (
    <Shell {...props}>
      <NewTokenForm {...props} />
    </Shell>
  )
}

function NewTokenForm({ brandSlug, apiSlug, authHeader, onOpenChange, onChanged }: Common & { authHeader: AuthHeaderStyle }) {
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState<ExpiryChoice>({ kind: 'never' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [made, setMade] = useState<NewToken | null>(null)

  if (made) {
    return <Created title="Token created" made={made} authHeader={authHeader} note="Paste it into Jivox." onDone={() => onOpenChange(false)} />
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    const trimmed = name.trim()
    const next: Record<string, string> = {}
    if (!trimmed) next.name = 'Give it a name, e.g. "Jivox qa3"'
    else if (trimmed.length > NAME_MAX) next.name = `At most ${NAME_MAX} characters`
    const expiresAt = expiryToIso(expiry)
    if ('error' in expiresAt) next.expiresAt = expiresAt.error
    setErrors(next)
    if (Object.keys(next).length > 0 || 'error' in expiresAt) return
    setSaving(true)
    try {
      setMade(await tokensApi.create(brandSlug, apiSlug, { name: trimmed, expiresAt: expiresAt.iso }))
      onChanged()
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (error.code === 'TOKEN_NAME_TAKEN') setErrors({ name: 'This API already has a token with this name' })
      else if (error.code === 'VALIDATION_ERROR') setErrors(fieldErrorsOf(error))
      else setErrors({ form: error.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle>New token</DialogTitle>
        <DialogDescription>Jivox sends it with every call to this API.</DialogDescription>
      </DialogHeader>
      <FormField id="token-name" label="Name" error={errors.name} hint="So you can tell tokens apart, e.g. where it's used.">
        {(field) => (
          <Input
            {...field}
            autoFocus
            autoComplete="off"
            placeholder="Jivox qa3"
            maxLength={NAME_MAX + 20}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setErrors(({ name: _drop, ...rest }) => rest)
            }}
          />
        )}
      </FormField>
      <ExpiryPicker
        value={expiry}
        error={errors.expiresAt}
        onChange={(choice) => {
          setExpiry(choice)
          setErrors(({ expiresAt: _drop, ...rest }) => rest)
        }}
      />
      {errors.form && (
        <p role="alert" className="flex gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {errors.form}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Create token
        </Button>
      </DialogFooter>
    </form>
  )
}

// ── Rename ──
export function RenameTokenDialog(props: Common & { token: TokenInfo }) {
  return (
    <Shell {...props}>
      <RenameForm {...props} />
    </Shell>
  )
}

function RenameForm({ brandSlug, apiSlug, token, onOpenChange, onChanged }: Common & { token: TokenInfo }) {
  const [name, setName] = useState(token.name)
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const close = () => onOpenChange(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    const trimmed = name.trim()
    if (!trimmed) return setError('Give it a name')
    if (trimmed.length > NAME_MAX) return setError(`At most ${NAME_MAX} characters`)
    if (trimmed === token.name) return close()
    setSaving(true)
    try {
      await tokensApi.update(brandSlug, apiSlug, token.id, { name: trimmed })
      toast.success(`Renamed to "${trimmed}"`)
      close()
      onChanged()
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      if (handledGone(err, token.name, close, onChanged)) return
      setError(err.code === 'TOKEN_NAME_TAKEN' ? 'This API already has a token with this name' : err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Rename token</DialogTitle>
        <DialogDescription>Only the name changes; the token stays the same.</DialogDescription>
      </DialogHeader>
      <FormField id="token-rename" label="Name" error={error}>
        {(field) => (
          <Input
            {...field}
            autoFocus
            autoComplete="off"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setError(undefined)
            }}
          />
        )}
      </FormField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}

// ── Extend: same token, new expiry (nothing to change in Jivox) ──
export function ExtendTokenDialog(props: Common & { token: TokenInfo }) {
  return (
    <Shell {...props}>
      <ExtendForm {...props} />
    </Shell>
  )
}

function ExtendForm({ brandSlug, apiSlug, token, onOpenChange, onChanged }: Common & { token: TokenInfo }) {
  const [expiry, setExpiry] = useState<ExpiryChoice>({ kind: 'days', days: 30 })
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const close = () => onOpenChange(false)
  const look = expiryLook(token)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    const result = expiryToIso(expiry)
    if ('error' in result) return setError(result.error)
    setSaving(true)
    try {
      await tokensApi.update(brandSlug, apiSlug, token.id, { expiresAt: result.iso })
      toast.success(result.iso === null ? `"${token.name}" now never expires` : `"${token.name}" extended`)
      close()
      onChanged()
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      if (handledGone(err, token.name, close, onChanged)) return
      setError(err.code === 'VALIDATION_ERROR' ? (err.details[0]?.message ?? err.message) : err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Extend "{token.name}"</DialogTitle>
        <DialogDescription>Same token, new date. Nothing to change in Jivox.</DialogDescription>
      </DialogHeader>
      <p className={look.tone === 'expired' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
        {look.tone === 'expired' ? `${look.text} (${look.title}).` : token.expiresAt ? `Now: ${look.title ?? look.text}.` : 'Now: never expires.'}
      </p>
      <ExpiryPicker
        label="New expiry"
        value={expiry}
        error={error}
        onChange={(choice) => {
          setExpiry(choice)
          setError(undefined)
        }}
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Extend
        </Button>
      </DialogFooter>
    </form>
  )
}

// ── Renew: a NEW token (same name); the old one stops at once ──
export function RenewTokenDialog(props: Common & { token: TokenInfo; authHeader: AuthHeaderStyle }) {
  return (
    <Shell {...props}>
      <RenewForm {...props} />
    </Shell>
  )
}

function RenewForm({ brandSlug, apiSlug, token, authHeader, onOpenChange, onChanged }: Common & { token: TokenInfo; authHeader: AuthHeaderStyle }) {
  const [expiry, setExpiry] = useState<ExpiryChoice>({ kind: 'never' })
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [made, setMade] = useState<NewToken | null>(null)
  const close = () => onOpenChange(false)

  if (made) {
    return (
      <Created
        title="New token ready"
        made={made}
        authHeader={authHeader}
        note={
          <>
            <strong className="font-medium text-foreground">Paste it into Jivox now:</strong> the old "{token.name}" token stopped working.
            {made.agentsMoved ? ` ${made.agentsMoved} Jivox agent${made.agentsMoved === 1 ? ' now uses' : 's now use'} the new one: paste it in Studio for ${made.agentsMoved === 1 ? 'it' : 'each'} (Agent access token).` : ''}
          </>
        }
        onDone={close}
      />
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    const result = expiryToIso(expiry)
    if ('error' in result) return setError(result.error)
    setSaving(true)
    try {
      setMade(await tokensApi.renew(brandSlug, apiSlug, token.id, { expiresAt: result.iso }))
      onChanged()
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      if (handledGone(err, token.name, close, onChanged)) return
      setError(err.code === 'VALIDATION_ERROR' ? (err.details[0]?.message ?? err.message) : err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Renew "{token.name}"</DialogTitle>
        <DialogDescription>
          You get a new token. The old one stops working right away, so paste the new one into Jivox.
        </DialogDescription>
      </DialogHeader>
      <ExpiryPicker
        value={expiry}
        error={error}
        onChange={(choice) => {
          setExpiry(choice)
          setError(undefined)
        }}
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Renew token
        </Button>
      </DialogFooter>
    </form>
  )
}

// ── Revoke (final) ──
export function RevokeTokenDialog({
  open,
  onOpenChange,
  brandSlug,
  apiSlug,
  token,
  lastActiveOfPublished,
  onChanged,
  returnFocusTo,
}: Common & { token: TokenInfo; lastActiveOfPublished: boolean }) {
  const [revoking, setRevoking] = useState(false)

  async function revoke(event: MouseEvent) {
    event.preventDefault() // stay open until the server answered
    if (revoking) return
    setRevoking(true)
    try {
      await tokensApi.revoke(brandSlug, apiSlug, token.id)
      toast.success(`"${token.name}" revoked`)
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      if (err.code !== 'TOKEN_NOT_FOUND') {
        toast.error(err.message)
        setRevoking(false)
        return
      }
    }
    setRevoking(false)
    onOpenChange(false)
    onChanged()
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (returnFocusTo?.current?.isConnected) {
            event.preventDefault()
            returnFocusTo.current.focus()
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke "{token.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            Calls with this token fail from now on. This can't be undone; you can make a new token any time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {lastActiveOfPublished && (
          <p role="alert" className="flex gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            It's the last active token of this published API: Jivox's calls will fail until you create or renew one.
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={revoke} disabled={revoking}>
            {revoking && <Loader2 className="animate-spin" />}
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
