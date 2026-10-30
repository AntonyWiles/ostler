/**
 * Off screen (`offScreen` in `electron/app/off-screen.ts`) Ostler copies into a
 * clipboard of its own, in main's memory, and never touches the Windows one.
 * It lives on main's `globalThis` under this registered symbol's key, so a test
 * reads it with `electronApp.evaluate` (which runs beside main's bundle, not in
 * it) and the monkey reports it as what Ostler last copied.
 */
export const OFF_SCREEN_CLIPBOARD_KEY = 'ostler.offScreenClipboard'

/** The slot on main's `globalThis`: the text last copied off screen. */
export interface OffScreenClipboard {
  text: string
}

/**
 * Main passes this to every page it opens off screen (additionalArguments),
 * so the preload handles the copy, cut and paste keys with Ostler's own clipboard.
 */
export const OFF_SCREEN_ARGUMENT = '--ostler-off-screen'

export type ClipboardKey = 'copy' | 'cut' | 'paste'

/** A key press, as a page's `keydown` event has it. */
export interface ClipboardKeyPress {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

/** The keys Chromium copies, cuts or pastes with in a page; null for any other key. */
export function clipboardKey(press: ClipboardKeyPress): ClipboardKey | null {
  if (press.altKey || press.metaKey) return null
  const key = press.key.toLowerCase()
  if (press.ctrlKey) {
    if ((key === 'c' || key === 'insert') && !press.shiftKey) return 'copy'
    if (key === 'x' && !press.shiftKey) return 'cut'
    // Ctrl+Shift+V pastes as plain text: the same, for text.
    if (key === 'v') return 'paste'
    return null
  }
  if (press.shiftKey && key === 'insert') return 'paste'
  if (press.shiftKey && key === 'delete') return 'cut'
  return null
}
