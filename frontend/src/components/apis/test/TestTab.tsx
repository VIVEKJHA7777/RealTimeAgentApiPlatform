import { useState } from 'react'
import { useApiPage } from '@/components/apis/api-page/context'
import { useTokens } from '@/lib/use-tokens'
import { CallCard } from './CallCard'
import { RecentCallsCard } from './RecentCallsCard'
import { SelfCheckCard } from './SelfCheckCard'
import { TokensCard } from './TokensCard'

// The API page's Test tab (Phase 4, mockup 1): tokens (4.6), then calling it, Try it and the
// self-check (4.7), then the last calls to the live URL (4.8c). Publish is in the page header. The token list and the ids box are shared.
export function TestTab() {
  const { organization, api, refresh, readinessChanged } = useApiPage()
  const tokens = useTokens(organization.slug, api.slug)
  const [idsText, setIdsText] = useState('')
  return (
    <div className="flex flex-col gap-6">
      <TokensCard
        brandSlug={organization.slug}
        api={api}
        list={tokens}
        onApiChanged={() => void refresh()}
        onTokensChanged={readinessChanged}
      />
      <CallCard brandSlug={organization.slug} api={api} tokens={tokens.data?.tokens ?? []} idsText={idsText} onIdsTextChange={setIdsText} />
      <SelfCheckCard brandSlug={organization.slug} api={api} idsText={idsText} />
      <RecentCallsCard brandSlug={organization.slug} api={api} />
    </div>
  )
}
