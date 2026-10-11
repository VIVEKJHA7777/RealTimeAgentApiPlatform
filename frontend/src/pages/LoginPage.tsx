import { AlertCircle, Loader2 } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { toast } from 'sonner'
import { useAuth } from '@/auth/useAuth'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { PasswordInput } from '@/components/auth/PasswordInput'
import { FormField } from '@/components/forms/FormField'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ApiError, fieldErrorsOf } from '@/lib/api'
import { compactErrors, validateEmail } from '@/lib/validation'

export function LoginPage() {
  const { login } = useAuth()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // A ref blocks a second submit instantly, even before React re-renders the disabled button.
  const submittingRef = useRef(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submittingRef.current) return

    // 1. Quick checks in the browser: no request if something is obviously missing.
    const errors = compactErrors({
      email: validateEmail(email),
      password: password ? undefined : 'Password is required',
    })
    setFieldErrors(errors)
    setFormError(null)
    if (Object.keys(errors).length > 0) return

    // 2. Ask the backend.
    submittingRef.current = true
    setSubmitting(true)
    try {
      const user = await login({ email, password })
      toast.success(`Welcome back${user.name ? `, ${user.name}` : ''}`)
      // No navigate() here: RedirectIfAuthed sees we're logged in and redirects
      // (to the page we originally wanted, or the home page).
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (error.code === 'INVALID_CREDENTIALS' || error.code === 'TOO_MANY_ATTEMPTS') {
        setFormError(error.message) // same text for unknown email and wrong password; 429 says when to retry (6.0)
      } else if (error.code === 'VALIDATION_ERROR') {
        setFieldErrors(fieldErrorsOf(error))
      } else {
        toast.error(error.message) // e.g. "Can't reach the server. Try again."
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to your account"
      footer={
        <>
          No account?{' '}
          <Link to="/signup" state={location.state} className="font-medium text-primary hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="grid gap-5">
        <FormField id="email" label="Email" error={fieldErrors.email}>
          {(field) => (
            <Input
              {...field}
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="name@company.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setFieldErrors(({ email: _removed, ...rest }) => rest)
              }}
            />
          )}
        </FormField>

        <FormField id="password" label="Password" error={fieldErrors.password}>
          {(field) => (
            <PasswordInput
              {...field}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setFieldErrors(({ password: _removed, ...rest }) => rest)
              }}
            />
          )}
        </FormField>

        {formError && (
          <Alert variant="destructive" className="animate-in fade-in duration-150">
            <AlertCircle />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" size="lg" className="h-10 w-full" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          {submitting ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
    </AuthLayout>
  )
}
