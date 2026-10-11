import { Loader2 } from 'lucide-react'
import { useState, type MouseEvent, type RefObject } from 'react'
import { useNavigate } from 'react-router'
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
import { ApiError, apisApi } from '@/lib/api'
import type { Api, DataSource } from '@/lib/api-types'
import { formatNumber } from '@/lib/format'

// "Delete API": a simple confirmation (decided in the 2.7 review). Only the API goes; its data
// stays (other APIs may use it, and it can be reused for a new API).
export function DeleteApiDialog({
  open,
  onOpenChange,
  brandSlug,
  api,
  dataSource,
  returnFocusTo,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  brandSlug: string
  api: Api
  dataSource: DataSource
  returnFocusTo?: RefObject<HTMLElement | null> // opened from a menu: where keyboard focus goes back on Cancel
}) {
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)
  const others = dataSource.usedBy.filter((ref) => ref.id !== api.id)

  async function remove(event: MouseEvent) {
    event.preventDefault() // keep the dialog open until the server has answered
    if (deleting) return
    setDeleting(true)
    try {
      await apisApi.remove(brandSlug, api.slug)
      toast.success(`"${api.name}" deleted`)
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (error.code !== 'API_NOT_FOUND') {
        toast.error(error.message)
        setDeleting(false)
        return
      }
      toast.info(`"${api.name}" was already deleted`) // e.g. from another tab
    }
    onOpenChange(false)
    navigate(`/brands/${brandSlug}`, { replace: true })
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (returnFocusTo?.current?.isConnected) {
            event.preventDefault()
            returnFocusTo.current.focus()
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{api.name}"?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                <span className="font-mono text-xs break-all text-foreground">{api.path}</span> stops answering right away.
                This can't be undone.
              </p>
              <p>
                Its data, <span className="font-medium text-foreground">{dataSource.name}</span>
                {dataSource.hasData && ` (${formatNumber(dataSource.rowCount)} rows)`}, is kept
                {others.length > 0
                  ? `: ${others.length === 1 ? 'another API uses' : `${others.length} other APIs use`} it (${others.map((ref) => ref.name).join(', ')}).`
                  : '. You can use it for a new API, or delete it from the brand page.'}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={remove} disabled={deleting}>
            {deleting && <Loader2 className="animate-spin" />}
            {deleting ? 'Deleting…' : 'Delete API'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
