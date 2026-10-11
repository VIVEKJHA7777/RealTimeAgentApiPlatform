import { Loader2 } from 'lucide-react'
import { useState, type MouseEvent, type RefObject } from 'react'
import { toast } from 'sonner'
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
import { ApiError, testingApi } from '@/lib/api'
import type { Api } from '@/lib/api-types'

// "Unpublish" (⋯ menu of a published API): /v1 answers 404 from the next call. Tokens, design and
// data stay; publishing again brings it back at once.
export function UnpublishDialog({
  open,
  onOpenChange,
  brandSlug,
  api,
  onDone,
  returnFocusTo,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  brandSlug: string
  api: Api
  onDone: () => Promise<void> | void
  returnFocusTo?: RefObject<HTMLElement | null>
}) {
  const [busy, setBusy] = useState(false)

  async function unpublish(event: MouseEvent) {
    event.preventDefault() // stay open until the server answered
    if (busy) return
    setBusy(true)
    try {
      await testingApi.unpublish(brandSlug, api.slug)
      toast.success(`"${api.name}" is a draft again`, { description: 'Jivox gets 404 until you publish it again.' })
      onOpenChange(false)
      await onDone()
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
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
          <AlertDialogTitle>Unpublish "{api.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            Jivox's calls to <code className="font-mono break-all">{api.path}</code> get 404 from the next call. Tokens, design and data stay;
            publish again any time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={unpublish} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Unpublish
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
