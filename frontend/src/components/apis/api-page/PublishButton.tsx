import { AlertCircle, ArrowRight, Loader2, Rocket } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { ApiError, testingApi } from '@/lib/api'
import type { Api, Organization, PublishReason } from '@/lib/api-types'
import { useRequest } from '@/lib/use-request'

const FIX_IN: Record<PublishReason['code'], { tab: string; label: string }> = {
  NO_DESIGN: { tab: 'design', label: 'Design tab' },
  DESIGN_INVALID: { tab: 'design', label: 'Design tab' },
  NO_DATA: { tab: 'data', label: 'Data tab' },
  NO_ACTIVE_TOKEN: { tab: 'test', label: 'Test tab' },
}

// "Publish" in the API page header (task 4.7; rules in 4.4). Only for drafts: a published API
// shows its green badge and has "Unpublish" in the ⋯ menu.
// The button is always clickable and the SERVER decides: blocked → a popover lists every reason
// with where to fix it. A small mark shows ahead of time that something is missing.
export function PublishButton({
  organization,
  api,
  readinessTick,
  onChanged,
}: {
  organization: Organization
  api: Api
  readinessTick: number
  onChanged: () => Promise<void> | void
}) {
  const [busy, setBusy] = useState(false)
  const [reasons, setReasons] = useState<PublishReason[] | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // What's missing, ahead of time (refreshed when the design, data or tokens change).
  const check = useRequest(
    `publish-check:${organization.slug}/${api.slug}:${api.designVersion}:${api.dataSource.rowCount}:${readinessTick}`,
    () => testingApi.publishCheck(organization.slug, api.slug),
    { refetchOnFocus: true, keepPreviousData: true },
  )
  const missing = check.data && !check.data.canPublish ? check.data.reasons.length : 0
  const base = `/brands/${organization.slug}/apis/${api.slug}`

  if (api.status !== 'draft') return null

  async function publish() {
    if (busy) return
    setBusy(true)
    try {
      await testingApi.publish(organization.slug, api.slug)
      setReasons(null)
      toast.success(`"${api.name}" is published`, { description: `Jivox can call ${api.path} now.` })
      await onChanged()
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      if (err.code === 'PUBLISH_BLOCKED') {
        setReasons(err.details.map((d) => ({ code: d.field as PublishReason['code'], message: d.message })))
        void check.refresh()
      } else toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover open={reasons !== null} onOpenChange={(open) => !open && setReasons(null)}>
      <PopoverAnchor asChild>
        <Button
          ref={buttonRef}
          onClick={() => void publish()}
          disabled={busy}
          aria-describedby={missing ? 'publish-missing' : undefined}
          title={missing ? `Not ready yet: ${missing} thing${missing === 1 ? '' : 's'} to do` : 'Make it callable on /v1'}
        >
          {busy ? <Loader2 className="animate-spin" /> : missing ? <AlertCircle /> : <Rocket />}
          Publish
          {missing > 0 && (
            <span id="publish-missing" className="sr-only">
              (not ready: {missing} to fix)
            </span>
          )}
        </Button>
      </PopoverAnchor>
      <PopoverContent
        align="end"
        className="w-[min(22rem,calc(100vw-2rem))] gap-3 p-4"
        aria-label="Why it can't be published yet"
        // Opened by the server's answer, not a Radix trigger: send focus back to the button ourselves
        // (unless a link inside moved to another tab).
        onCloseAutoFocus={(event) => {
          if (buttonRef.current?.isConnected) {
            event.preventDefault()
            buttonRef.current.focus()
          }
        }}
      >
        <p className="font-medium">Not ready to publish</p>
        <ul className="grid gap-3">
          {(reasons ?? []).map((reason) => (
            <li key={reason.code + reason.message} className="grid gap-1 text-sm">
              <span className="flex gap-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                {reason.message}
              </span>
              <Link
                to={`${base}/${FIX_IN[reason.code]?.tab ?? ''}`}
                onClick={() => setReasons(null)}
                className="ml-6 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Open the {FIX_IN[reason.code]?.label ?? 'API'} <ArrowRight className="size-3" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
