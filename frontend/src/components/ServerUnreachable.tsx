import { RotateCw, ServerOff } from 'lucide-react'
import { Logo } from '@/components/auth/AuthLayout'
import { Button } from '@/components/ui/button'

// Full-page screen when the backend didn't answer at all on page load.
// We don't show the login form here: the user's session may be perfectly fine.
export function ServerUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-6 text-center animate-in fade-in duration-300">
      <Logo className="mb-10" />
      <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <ServerOff className="size-6" />
      </div>
      <h1 className="mt-4 text-xl font-semibold">Can't reach the server</h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        The API Platform server isn't answering right now. Check that the backend is running, then
        try again.
      </p>
      <Button className="mt-6" onClick={onRetry}>
        <RotateCw />
        Try again
      </Button>
    </div>
  )
}
