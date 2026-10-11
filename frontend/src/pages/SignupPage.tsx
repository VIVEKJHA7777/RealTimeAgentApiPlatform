import { Loader2 } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { toast } from 'sonner'
import { useAuth } from '@/auth/useAuth'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { PasswordInput } from '@/components/auth/PasswordInput'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ApiError, fieldErrorsOf } from '@/lib/api'
import { compactErrors, validateEmail, validateNewPassword } from '@/lib/validation'

export function SignupPage() {
  const { signup } = useAuth()
  const location = useLocation()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [emailTaken, setEmailTaken] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false) // blocks a double submit instantly

  function clearError(field: string) {
    setFieldErrors(({ [field]: _removed, ...rest }) => rest)
    if (field === 'email') setEmailTaken(false)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submittingRef.current) return

    const errors = compactErrors({
      name: name.trim().length > 100 ? 'Name must be at most 100 characters' : undefined,
      email: validateEmail(email),
      password: validateNewPassword(password),
    })
    setFieldErrors(errors)
    setEmailTaken(false)
    if (Object.keys(errors).length > 0) return

    submittingRef.current = true
    setSubmitting(true)
    try {
      // Name is optional: send it only if something was typed.
      await signup({ email, password, name: name.trim() || undefined })
      toast.success('Account created')
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (error.code === 'EMAIL_TAKEN') {
        setFieldErrors({ email: error.message })
        setEmailTaken(true)
      } else if (error.code === 'SIGNUP_CLOSED') {
        setFieldErrors({ email: error.message }) // a server that only lets listed emails in (6.0)
      } else if (error.code === 'VALIDATION_ERROR') {
        setFieldErrors(fieldErrorsOf(error))
      } else {
        toast.error(error.message) // incl. TOO_MANY_ATTEMPTS (6.0)
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start serving live product data in minutes"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" state={location.state} className="font-medium text-primary hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="grid gap-5">
        <FormField id="name" label="Name (optional)" error={fieldErrors.name}>
          {(field) => (
            <Input
              {...field}
              autoComplete="name"
              autoFocus
              placeholder="Alice Smith"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                clearError('name')
              }}
            />
          )}
        </FormField>

        <div className="grid gap-2">
          <FormField id="email" label="Email" error={fieldErrors.email}>
            {(field) => (
              <Input
                {...field}
                type="email"
                autoComplete="email"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  clearError('email')
                }}
              />
            )}
          </FormField>
          {emailTaken && (
            <Link
              to="/login"
              state={location.state}
              className="text-sm font-medium text-primary hover:underline"
            >
              Log in instead →
            </Link>
          )}
        </div>

        <FormField
          id="password"
          label="Password"
          error={fieldErrors.password}
          hint="At least 8 characters"
        >
          {(field) => (
            <PasswordInput
              {...field}
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                clearError('password')
              }}
            />
          )}
        </FormField>

        <Button type="submit" size="lg" className="h-10 w-full" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  )
}
