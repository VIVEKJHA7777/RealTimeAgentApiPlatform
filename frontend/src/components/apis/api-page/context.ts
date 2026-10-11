import { useOutletContext } from 'react-router'
import type { Api, DataSource, Organization } from '@/lib/api-types'

// What the API page (the layout: header + tabs) hands to the tab inside it (<Outlet />).
export type ApiPageContext = {
  organization: Organization
  api: Api
  dataSource: DataSource
  // Quiet reload of the API + its data (after an upload, an edit, or while importing).
  refresh: () => Promise<void>
  // Something that decides whether the API can be published changed (a token made / revoked…):
  // the header's Publish button checks again.
  readinessChanged: () => void
  readinessTick: number
}

export function useApiPage() {
  return useOutletContext<ApiPageContext>()
}
