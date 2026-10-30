/**
 * Whether a create form's "More details" is open, remembered per viewer in
 * localStorage, the way `navigation/last-view.ts` remembers views. A
 * convenience, not data: when storage is unavailable the section starts
 * closed.
 */
const KEY = 'ostler.taskMoreDetailsOpen'

export function readMoreDetailsOpen(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true'
  } catch {
    return false
  }
}

export function writeMoreDetailsOpen(open: boolean): void {
  try {
    localStorage.setItem(KEY, open ? 'true' : 'false')
  } catch {
    // ignore -- see readMoreDetailsOpen
  }
}
