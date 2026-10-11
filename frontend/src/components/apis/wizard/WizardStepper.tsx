import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WIZARD_STEPS } from './steps'


// 1 Details — 2 Data — 3 Review. Finished steps can be clicked to go back; later ones can't
// (each step's checks must pass first). On phones only "Step 2 of 3 · Data" is shown.
export function WizardStepper({ current, onGoTo }: { current: number; onGoTo: (step: number) => void }) {
  return (
    <nav aria-label="Steps">
      <p className="text-sm text-muted-foreground sm:hidden">
        Step {current} of {WIZARD_STEPS.length} · <span className="font-medium text-foreground">{WIZARD_STEPS[current - 1]}</span>
      </p>
      <ol className="hidden items-center gap-3 sm:flex">
        {WIZARD_STEPS.map((label, index) => {
          const step = index + 1
          const done = step < current
          const active = step === current
          return (
            <li key={label} className="flex flex-1 items-center gap-3 last:flex-none">
              <button
                type="button"
                onClick={() => done && onGoTo(step)}
                disabled={!done}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-lg text-sm transition-colors disabled:cursor-default',
                  done && 'text-foreground hover:text-primary',
                  active && 'font-medium text-foreground',
                  !done && !active && 'text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                    done && 'border-primary bg-primary text-primary-foreground',
                    active && 'border-primary text-primary ring-4 ring-primary/10',
                  )}
                >
                  {done ? <Check className="size-3.5" aria-hidden="true" /> : step}
                </span>
                {label}
                {done && <span className="sr-only">(done, go back)</span>}
              </button>
              {step < WIZARD_STEPS.length && (
                <span className={cn('h-px flex-1 bg-border', done && 'bg-primary/40')} aria-hidden="true" />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
