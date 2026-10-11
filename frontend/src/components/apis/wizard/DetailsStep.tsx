import { Info, RotateCcw } from 'lucide-react'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { API_SLUG_MAX } from '@/lib/api-slug'
import type { FeedType } from '@/lib/api-types'
import { cn } from '@/lib/utils'
import { FEED_TYPES } from '@/lib/feed-types'

export type Details = { name: string; slug: string; slugEdited: boolean; feedType: FeedType }

// Step 1: name, slug (suggested from the name until edited), feed type.
export function DetailsStep({
  brandSlug,
  details,
  errors,
  suggestion,
  onNameChange,
  onSlugChange,
  onUseSuggestion,
  onFeedTypeChange,
}: {
  brandSlug: string
  details: Details
  errors: Record<string, string>
  suggestion: string
  onNameChange: (value: string) => void
  onSlugChange: (value: string) => void
  onUseSuggestion: () => void
  onFeedTypeChange: (value: FeedType) => void
}) {
  const slugPreview = details.slug.trim() || 'your-api'
  return (
    <div className="grid grid-cols-1 gap-6">
      <FormField id="api-name" label="API name" error={errors.name} hint="Shown in the dashboard, for example Live prices.">
        {(field) => (
          <Input
            {...field}
            autoFocus
            placeholder="Live prices"
            maxLength={120}
            value={details.name}
            onChange={(event) => onNameChange(event.target.value)}
          />
        )}
      </FormField>

      <div className="grid grid-cols-1 gap-3">
        <FormField
          id="api-slug"
          label="Slug"
          error={errors.slug}
          hint={`Part of the address: lowercase letters, numbers and hyphens, up to ${API_SLUG_MAX} characters.`}
        >
          {(field) => (
            <div className="flex items-center gap-2">
              <Input
                {...field}
                className="font-mono"
                placeholder="live-prices"
                autoComplete="off"
                spellCheck={false}
                maxLength={API_SLUG_MAX + 10}
                value={details.slug}
                onChange={(event) => onSlugChange(event.target.value)}
              />
              {details.slugEdited && suggestion && suggestion !== details.slug && (
                <Button type="button" variant="ghost" size="sm" onClick={onUseSuggestion} title={`Use "${suggestion}"`}>
                  <RotateCcw />
                  Suggest
                </Button>
              )}
            </div>
          )}
        </FormField>
        <div className="rounded-xl border bg-muted/50 p-4">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Jivox will call</p>
          <p className="mt-2 font-mono text-sm break-all" data-testid="api-path-preview">
            /v1/{brandSlug}/<span className="text-primary">{slugPreview}</span>
          </p>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            You can change the slug later; Jivox then needs a new contract with the new address.
          </p>
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Feed type</legend>
        <p className="mt-1 text-xs text-muted-foreground">What kind of data this API answers with (the Jivox feed type).</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup" aria-label="Feed type">
          {FEED_TYPES.map(({ value, label, hint, icon: Icon, tone }) => {
            const selected = details.feedType === value
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${label}: ${hint}`}
                onClick={() => onFeedTypeChange(value)}
                className={cn(
                  'flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-4 focus-visible:ring-ring/20',
                  selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/40 hover:bg-muted/40',
                )}
              >
                <span className={cn('flex size-8 items-center justify-center rounded-lg', tone)}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>
    </div>
  )
}
