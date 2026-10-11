// Copies text that may still be on its way from the server (e.g. a token being fetched).
// The clipboard write starts IN the click: Safari refuses a write that starts after a network
// wait, so the text goes in as a promise (ClipboardItem). Older browsers: plain writeText.
// Resolves true when copied; false when there was nothing to copy (text resolved to null);
// throws when the browser refused (the caller then shows the text to copy by hand).
export async function copyToClipboard(text: string | Promise<string | null>): Promise<boolean> {
  const pending = Promise.resolve(text)
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    let empty = false
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': pending.then((t) => {
            if (t === null) {
              empty = true
              throw new Error('nothing to copy')
            }
            return new Blob([t], { type: 'text/plain' })
          }),
        }),
      ])
      return true
    } catch (err) {
      if (empty) return false
      throw err
    }
  }
  const t = await pending
  if (t === null) return false
  await navigator.clipboard.writeText(t)
  return true
}
