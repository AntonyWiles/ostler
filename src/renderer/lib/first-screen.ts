import { GLOBAL_VIEWS, PROJECT_VIEWS } from '../navigation/registry'

let done = false

/** How long after the first screen the views' code is fetched, if the window stays busy. */
const WARM_TIMEOUT_MS = 2_000

/**
 * The first screen (Home or a project view) is on, once per window (P9.1):
 * main may run the start-up work it held back (backups, housekeeping, Git
 * history), and the code of the project views and My work loads in the background, so the
 * first switch to a view does not wait for it.
 */
export function onFirstScreen(): void {
  if (done) return
  done = true
  void window.ostlerAPI?.reportFirstScreen?.()
  const warm = () => {
    for (const view of [...PROJECT_VIEWS, ...GLOBAL_VIEWS]) {
      if ('preload' in view) void view.preload().catch(() => undefined)
    }
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(warm, { timeout: WARM_TIMEOUT_MS })
  } else setTimeout(warm, 0)
}
