/**
 * Ask Ostler's "Search file contents" switch (N8.3a), remembered per viewer
 * in localStorage like the share options: a convenience, not data, so it is
 * no config setting (decision N2). On unless turned off.
 */
const KEY = 'ostler.askOstler.searchFiles'

export function readSearchFiles(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'false'
  } catch {
    return true
  }
}

export function writeSearchFiles(value: boolean): void {
  try {
    localStorage.setItem(KEY, value ? 'true' : 'false')
  } catch {
    // ignore -- see readSearchFiles
  }
}
