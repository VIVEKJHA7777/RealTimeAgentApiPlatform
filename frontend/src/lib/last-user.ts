// Who was logged in last in this browser tab (sessionStorage: per tab, gone when it closes).
// RequireAuth records it next to the page to return to after login, so that page is only
// reopened for the SAME user: another account logging in next would otherwise land on the
// previous account's brand ("Brand not found"). Storage can be blocked: then nobody is known
// and the page is followed as before.
const KEY = 'api-platform:last-user'

export function rememberUser(userId: string) {
  try {
    sessionStorage.setItem(KEY, userId)
  } catch {
    // storage blocked (private mode, policy): fine
  }
}

export function lastUserId(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}
