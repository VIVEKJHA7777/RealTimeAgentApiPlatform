import { tokensApi } from './api'
import { useRequest } from './use-request'

// An API's tokens, loaded once by the Test tab and shared by the Tokens card and the curl box.
// Reloads quietly when the browser tab becomes visible again (tokens may change in another tab).
export function useTokens(brandSlug: string, apiSlug: string) {
  return useRequest(`tokens:${brandSlug}/${apiSlug}`, () => tokensApi.list(brandSlug, apiSlug), { refetchOnFocus: true })
}
export type TokensRequest = ReturnType<typeof useTokens>
