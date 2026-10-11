import { Hexagon } from 'lucide-react'
import type { ReactNode } from 'react'

// Two-panel layout for /login and /signup:
// left = brand panel with a sample API response (hidden on small screens), right = the form.
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <BrandPanel />

      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm animate-in fade-in duration-300">
          {/* On small screens the brand panel is hidden, so show the logo here instead */}
          <Logo className="mb-10 lg:hidden" />

          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>

          <div className="mt-8">{children}</div>

          <p className="mt-8 text-center text-sm text-muted-foreground">{footer}</p>
        </div>
      </main>
    </div>
  )
}

export function Logo({ className = '', inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <div className={`flex items-center gap-2 font-semibold whitespace-nowrap ${className}`}>
      <span
        className={`flex size-8 items-center justify-center rounded-lg ${
          inverted ? 'bg-white/10 text-violet-200' : 'bg-primary text-primary-foreground'
        }`}
      >
        <Hexagon className="size-4" />
      </span>
      API Platform
    </div>
  )
}

function BrandPanel() {
  return (
    <aside className="relative hidden flex-col justify-between overflow-hidden bg-violet-950 p-10 text-violet-50 lg:flex">
      {/* Soft background glows */}
      <div className="pointer-events-none absolute -top-32 -left-24 size-96 rounded-full bg-violet-600/30 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 size-96 rounded-full bg-fuchsia-500/20 blur-3xl" />

      <Logo inverted className="relative" />

      <div className="relative max-w-md">
        <h2 className="text-3xl leading-tight font-semibold tracking-tight">
          Live product data for AI agents, in minutes.
        </h2>
        <p className="mt-3 text-violet-200/80">
          Upload your catalog, get a secure realtime API, and plug it into your Jivox agent.
        </p>

        <pre className="mt-8 overflow-hidden rounded-xl border border-white/10 bg-black/30 p-5 font-mono text-[13px] leading-6 text-violet-100 shadow-2xl backdrop-blur">
          <span className="text-emerald-300">GET</span> /v1/acme-shoes-k3x9q2/prices{'\n'}
          {'{\n'}
          {'  '}<span className="text-violet-300">"status"</span>: <span className="text-amber-200">"success"</span>,{'\n'}
          {'  '}<span className="text-violet-300">"data"</span>: [{'\n'}
          {'    '}{'{ '}<span className="text-violet-300">"id"</span>: <span className="text-amber-200">"SKU-1001"</span>, <span className="text-violet-300">"price"</span>: <span className="text-sky-300">79.99</span>{' }'}{'\n'}
          {'  '}]{'\n'}
          {'}'}
        </pre>
      </div>

      <p className="relative text-sm text-violet-300/70">Built for Jivox realtime agents</p>
    </aside>
  )
}
