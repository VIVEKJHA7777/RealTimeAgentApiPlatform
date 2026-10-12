import { AlertTriangle, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ApiError, switchesApi } from '@/lib/api'
import { bannerItem, bannerTitle, SWITCHES_CARD_ID } from '@/lib/switches'
import type { SwitchesHandle } from '@/lib/use-switches'

// On every tab of the API while a test switch is on (task 7.6): what is broken, for whom, until
// when. "Turn all off" doesn't ask (it only brings the API back to normal); a toast says what went.
export function SwitchBanner({ brandSlug, apiSlug, switches }: { brandSlug: string; apiSlug: string; switches: SwitchesHandle }) {
  const [busy, setBusy] = useState(false)
  if (switches.on.length === 0) return null

  async function allOff() {
    setBusy(true)
    try {
      const next = await switchesApi.off(brandSlug, apiSlug)
      switches.apply(next)
      toast.success(next.turnedOff === 1 ? 'Test switch turned off: the API answers normally again' : `${next.turnedOff ?? 0} test switches turned off: the API answers normally again`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't turn the switches off")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label="Test switches on"
      className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive dark:bg-destructive/15"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-60">
        <p className="font-medium">{bannerTitle(switches.on.length)}</p>
        <ul className="mt-0.5 text-xs">
          {switches.on.map((sw) => (
            <li key={sw.kind} className="break-words">
              {bannerItem(sw, switches.now)}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="outline" asChild className="border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive">
          <Link to={`/brands/${brandSlug}/apis/${apiSlug}/test#${SWITCHES_CARD_ID}`}>Manage</Link>
        </Button>
        <Button size="sm" variant="destructive" onClick={() => void allOff()} disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          Turn all off
        </Button>
      </div>
    </section>
  )
}
