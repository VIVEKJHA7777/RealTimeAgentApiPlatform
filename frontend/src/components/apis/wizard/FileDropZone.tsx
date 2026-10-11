import { FileUp } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { cn } from '@/lib/utils'

// Drag a file here, or click (or press Enter / Space) to choose one.
export function FileDropZone({
  onFile,
  maxMb,
  error,
}: {
  onFile: (file: File) => void
  maxMb: number
  error?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0) // dragenter/leave also fire for child elements: count them

  function take(files: FileList | null) {
    const file = files?.[0]
    if (file) onFile(file)
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    take(event.dataTransfer.files)
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault()
          dragDepth.current++
          setDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragging(false)
        }}
        onDrop={onDrop}
        aria-describedby={error ? 'file-error' : undefined}
        className={cn(
          'group flex w-full flex-col items-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/20',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/40',
          error && !dragging && 'border-destructive/50',
        )}
      >
        <span
          className={cn(
            'flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform',
            dragging && 'scale-110',
          )}
        >
          <FileUp className="size-6" aria-hidden="true" />
        </span>
        <span className="mt-4 text-sm font-medium">{dragging ? 'Drop the file to preview it' : 'Drop a CSV file here, or click to choose'}</span>
        <span className="mt-1 text-xs text-muted-foreground">
          CSV up to {maxMb} MB · comma, semicolon, tab or | separated · first row = column names
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose a CSV file"
        onChange={(event) => {
          take(event.target.files)
          event.target.value = '' // choosing the same file again still triggers onChange
        }}
      />
      {error && (
        <p id="file-error" role="alert" className="mt-2 text-sm text-destructive animate-in fade-in duration-150">
          {error}
        </p>
      )}
    </div>
  )
}
