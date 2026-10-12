import { ChevronDown, ChevronRight } from 'lucide-react'
import { useId } from 'react'
import { useRememberedOpen } from '@/lib/use-remembered-open'

const STEPS = [
  ['Upload a feed', 'A CSV of products, reviews, stores or content.'],
  ['Design the answer', 'Map your columns to Jivox fields and shape the request.'],
  ['Token and publish', 'Your API goes live at its own address.'],
  ['Add the Jivox agent', 'Link the Real Time Agent and run its checklist.'],
  ['Submit the contract', 'Jivox verifies and activates it; every call shows in Logs.'],
] as const

// The home page's welcome strip (2026-10-13, option B chosen by the product's author): what the product
// is, who conceived and built it, and the flow in 5 steps (opened on demand, remembered per browser).
export function WelcomeStrip() {
  const [open, setOpen] = useRememberedOpen('home.howItWorks.open', false)
  const stepsId = useId()
  return (
    <section aria-labelledby="welcome-heading" className="rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6">
      <p className="text-xs font-semibold tracking-wide text-primary uppercase">Realtime APIs for Jivox agents</p>
      <h1 id="welcome-heading" className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
        Turn any product feed into a live API Jivox can trust
      </h1>
      <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
        Upload a feed, shape the answer, publish, and watch every call. Conceived and built by{' '}
        <span className="font-medium text-foreground">Vivek Kumar Jha</span>.
      </p>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={stepsId}
        className="mt-3 flex items-center gap-1 rounded-md text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
        How it works
      </button>
      {open && (
        <ol id={stepsId} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="rounded-xl border bg-background p-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs text-primary" aria-hidden="true">
                  {i + 1}
                </span>
                {title}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
