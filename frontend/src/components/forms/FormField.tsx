import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'

// Label + input + (hint or error) with the accessibility wiring done once:
// the input gets aria-invalid and aria-describedby pointing at the message below it.
export function FormField({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string
  label: string
  error?: string
  hint?: string
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode
}) {
  const messageId = error || hint ? `${id}-message` : undefined
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': messageId })}
      {error ? (
        <p id={messageId} className="text-sm text-destructive animate-in fade-in duration-150">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
