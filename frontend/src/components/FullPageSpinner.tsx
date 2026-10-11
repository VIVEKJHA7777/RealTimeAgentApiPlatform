import { Loader2 } from 'lucide-react'

// Shown for the brief moment while we ask the backend who is logged in.
export function FullPageSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center" role="status" aria-label="Loading">
      <Loader2 className="size-6 animate-spin text-primary" />
    </div>
  )
}
