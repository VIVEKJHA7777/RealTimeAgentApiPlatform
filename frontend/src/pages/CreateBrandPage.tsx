import { ArrowLeft, Info, Loader2, RotateCcw } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ApiError, fieldErrorsOf, organizationsApi } from '@/lib/api'
import { SLUG_BASE_MAX, normalizeSlugInput, suggestSlug, validateSlugBase } from '@/lib/slug'
import { compactErrors } from '@/lib/validation'

// "/brands/new": create a brand. The slug is suggested from the name until the user edits it;
// the server then adds "-" + 6 random characters to make it unique.
export function CreateBrandPage() {
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false) // stop auto-suggesting once the user types a slug
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false) // blocks a double submit instantly

  const suggestion = suggestSlug(name)

  function clearError(field: string) {
    setFieldErrors(({ [field]: _removed, ...rest }) => rest)
  }

  function handleNameChange(value: string) {
    setName(value)
    clearError('name')
    if (!slugEdited) {
      setSlug(suggestSlug(value))
      clearError('slug')
    }
  }

  function handleSlugChange(value: string) {
    setSlug(normalizeSlugInput(value))
    setSlugEdited(true)
    clearError('slug')
  }

  function useSuggestion() {
    setSlug(suggestion)
    setSlugEdited(false)
    clearError('slug')
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submittingRef.current) return

    const errors = compactErrors({
      name: !name.trim() ? 'Name is required' : name.trim().length > 100 ? 'Name must be at most 100 characters' : undefined,
      slug: validateSlugBase(slug),
    })
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    submittingRef.current = true
    setSubmitting(true)
    try {
      const { organization } = await organizationsApi.create({ name: name.trim(), slug: slug.trim() })
      toast.success(`"${organization.name}" created`)
      // replace: pressing Back on the new brand's page returns to the list, not to this form
      navigate(`/brands/${organization.slug}`, { replace: true })
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (error.code === 'VALIDATION_ERROR') {
        setFieldErrors(fieldErrorsOf(error))
      } else {
        toast.error(error.message) // network down, or the (practically impossible) SLUG_TAKEN
      }
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const previewBase = slug.trim() || 'your-brand'

  return (
    <div className="mx-auto max-w-2xl animate-in fade-in duration-300">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Brands
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Create a brand</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        A brand holds one company's product data and gets its own realtime API.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-8 rounded-2xl border bg-background p-6 shadow-sm">
        <div className="grid gap-6">
          <FormField id="name" label="Brand name" error={fieldErrors.name} hint="Shown in the dashboard. You can use any characters.">
            {(field) => (
              <Input
                {...field}
                autoFocus
                placeholder="Acme Shoes"
                maxLength={120}
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
              />
            )}
          </FormField>

          <div className="grid gap-2">
            <FormField
              id="slug"
              label="Slug"
              error={fieldErrors.slug}
              hint={`3–${SLUG_BASE_MAX} characters: lowercase letters, numbers and hyphens. Can't be changed later.`}
            >
              {(field) => (
                <div className="flex items-center gap-2">
                  <Input
                    {...field}
                    className="font-mono"
                    placeholder="acme-shoes"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={SLUG_BASE_MAX + 10}
                    value={slug}
                    onChange={(e) => handleSlugChange(e.target.value)}
                  />
                  {slugEdited && suggestion && suggestion !== slug && (
                    <Button type="button" variant="ghost" size="sm" onClick={useSuggestion} title={`Use "${suggestion}"`}>
                      <RotateCcw />
                      Suggest
                    </Button>
                  )}
                </div>
              )}
            </FormField>
          </div>

          {/* Live preview of the final API path */}
          <div className="rounded-xl border bg-muted/50 p-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Your API path will look like</p>
            <p className="mt-2 font-mono text-sm break-all" data-testid="slug-preview">
              /v1/<span className="text-foreground">{previewBase}</span>
              <span className="text-primary">-xxxxxx</span>
            </p>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              We add 6 random characters so your slug is always unique. No need to check if a name is taken.
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" size="lg" className="h-10" onClick={() => navigate('/')}>
            Cancel
          </Button>
          <Button type="submit" size="lg" className="h-10" disabled={submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            {submitting ? 'Creating…' : 'Create brand'}
          </Button>
        </div>
      </form>
    </div>
  )
}
