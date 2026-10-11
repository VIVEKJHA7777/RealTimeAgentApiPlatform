import { Download, Ellipsis, Loader2, Trash2 } from 'lucide-react'
import { useRef, useState, type MouseEvent } from 'react'
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
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ApiError, dataSourcesApi } from '@/lib/api'
import type { DataSource } from '@/lib/api-types'
import { formatNumber } from '@/lib/format'
import { isImportActive } from '@/lib/imports'

// ⋯ on a row of the brand page's Data list: Download CSV · Delete data.
// Deleting is only offered when no API uses the data and no import runs (the backend checks
// both too, race-safe, and answers 409; we show its message).
export function DataSourceActions({
  brandSlug,
  dataSource,
  onDeleted,
}: {
  brandSlug: string
  dataSource: DataSource
  onDeleted: () => Promise<void> | void
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const menuRef = useRef<HTMLButtonElement>(null) // keyboard focus goes back here when the dialog closes
  const used = dataSource.usedBy.length
  const importing = isImportActive(dataSource.latestImport)
  const blockedReason =
    used > 0
      ? `Used by ${dataSource.usedBy.map((ref) => ref.name).join(', ')}. Delete or switch ${used === 1 ? 'that API' : 'those APIs'} first.`
      : importing
        ? 'An import is running. Wait until it finishes.'
        : null

  async function remove(event: MouseEvent) {
    event.preventDefault() // keep the dialog open until the server answered
    if (deleting) return
    setDeleting(true)
    try {
      await dataSourcesApi.remove(brandSlug, dataSource.id)
      toast.success(`"${dataSource.name}" deleted`)
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (error.code === 'DATA_SOURCE_NOT_FOUND') toast.info(`"${dataSource.name}" was already deleted`)
      else toast.error(error.message) // DATA_SOURCE_IN_USE / IMPORT_IN_PROGRESS (a race), network…
    }
    setDeleting(false)
    setConfirming(false)
    await onDeleted()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={menuRef} variant="ghost" size="icon-sm" aria-label={`Actions for ${dataSource.name}`}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {dataSource.hasData ? (
            <DropdownMenuItem asChild>
              <a href={dataSourcesApi.downloadUrl(brandSlug, dataSource.id)} download>
                <Download />
                Download CSV
              </a>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled>
              <Download />
              Download CSV (no data yet)
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" disabled={blockedReason !== null} onSelect={() => setConfirming(true)}>
            <Trash2 />
            Delete data
          </DropdownMenuItem>
          {blockedReason && (
            <DropdownMenuLabel className="text-xs font-normal whitespace-normal text-muted-foreground">{blockedReason}</DropdownMenuLabel>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={(open) => !deleting && setConfirming(open)}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            if (menuRef.current?.isConnected) {
              event.preventDefault()
              menuRef.current.focus()
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{dataSource.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {dataSource.hasData ? `All ${formatNumber(dataSource.rowCount)} rows` : 'This data'} and its import history are
              deleted. No API uses it. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove} disabled={deleting}>
              {deleting && <Loader2 className="animate-spin" />}
              {deleting ? 'Deleting…' : 'Delete data'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
