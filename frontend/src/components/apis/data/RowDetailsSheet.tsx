import { KeyRound } from 'lucide-react'
import { useRef } from 'react'
import { CopyButton } from '@/components/CopyButton'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { RecordsPage } from '@/lib/api-types'
import { formatNumber } from '@/lib/format'

type Row = RecordsPage['records'][number]

// One row, all its columns listed top to bottom (easier than scrolling 20+ columns sideways).
// Values are shown exactly as stored (text); empty = no value.
export function RowDetailsSheet({
  row,
  columns,
  idColumn,
  onClose,
}: {
  row: Row | null
  columns: string[]
  idColumn: string
  onClose: () => void
}) {
  // The panel is opened from table rows, not from a Radix trigger, so Radix can't know where to
  // put keyboard focus back. We remember the element that had focus when it opened (the row's
  // id button) and return focus there on close: keyboard users keep their place in the table.
  const openerRef = useRef<HTMLElement | null>(null)
  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="w-full overflow-y-auto sm:max-w-md"
        onOpenAutoFocus={() => {
          openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        }}
        onCloseAutoFocus={(event) => {
          const opener = openerRef.current
          if (opener && opener !== document.body && opener.isConnected) {
            event.preventDefault()
            opener.focus()
          }
        }}
      >
        {row && (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono break-all">{row.id}</SheetTitle>
              <SheetDescription>
                Row {formatNumber(row.position)} · {columns.length} columns · values as stored
              </SheetDescription>
            </SheetHeader>
            <dl className="divide-y px-4 pb-6">
              {columns.map((column, index) => {
                const value = row.values[index]
                const isId = column === idColumn
                return (
                  <div key={column} className="grid grid-cols-1 gap-1 py-3">
                    <dt className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                      {isId && <KeyRound className="size-3 text-primary" aria-label="id column" />}
                      <span className={isId ? 'text-primary' : undefined}>{column}</span>
                    </dt>
                    <dd className="flex items-start justify-between gap-2 text-sm">
                      {value === null ? (
                        <span className="text-muted-foreground/60 italic">empty</span>
                      ) : (
                        <>
                          <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{value}</span>
                          <CopyButton value={value} label={`Copy ${column}`} />
                        </>
                      )}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
