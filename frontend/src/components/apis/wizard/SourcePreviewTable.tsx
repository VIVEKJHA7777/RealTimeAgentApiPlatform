import { KeyRound } from 'lucide-react'
import type { SourcePreview } from '@/lib/api-types'
import { cn } from '@/lib/utils'

// The first rows of the file, exactly as they'll be stored (text, empty = no value).
// The table scrolls sideways INSIDE its box, so wide files never push the page sideways.
export function SourcePreviewTable({ preview, idColumn }: { preview: SourcePreview; idColumn: string | null }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="max-h-80 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">First {preview.sampleRows.length} rows of the file</caption>
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th scope="col" className="w-12 px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                Row
              </th>
              {preview.columns.map((column) => {
                const isId = column === idColumn
                return (
                  <th
                    key={column}
                    scope="col"
                    className={cn(
                      'max-w-60 px-3 py-2 text-left text-xs font-medium whitespace-nowrap',
                      isId ? 'bg-primary/10 text-primary' : 'text-muted-foreground',
                    )}
                  >
                    <span className="flex items-center gap-1">
                      {isId && <KeyRound className="size-3" aria-label="id column" />}
                      <span className="truncate" title={column}>
                        {column}
                      </span>
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {preview.sampleRows.map((row) => (
              <tr key={row.rowNumber} className="border-t">
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground tabular-nums">{row.rowNumber}</td>
                {row.values.map((value, index) => {
                  const isId = preview.columns[index] === idColumn
                  return (
                    <td
                      key={index}
                      className={cn(
                        'max-w-60 truncate px-3 py-2 whitespace-nowrap',
                        isId && 'bg-primary/5 font-mono text-xs font-medium',
                      )}
                      title={value ?? undefined}
                    >
                      {value ?? <span className="text-muted-foreground/60 italic">empty</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
