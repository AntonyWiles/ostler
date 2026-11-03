/**
 * React's development build records a `performance.measure` for every
 * component render and effect (its DevTools "Performance tracks"), and the
 * browser keeps every entry until it is cleared. A dev window that re-renders
 * often, such as one with agents writing through the automation API, gathers
 * millions of them and grows by gigabytes until it stops responding.
 *
 * A Performance recording in DevTools captures each measure as it is made, so
 * emptying the buffer now and then loses nothing there. Ostler's own timings
 * are marks, not measures, and stay. Production builds record no measures.
 */
const CLEAR_EVERY_MS = 10_000

export function keepReactPerfBufferSmall(): void {
  if (!import.meta.env.DEV) return
  setInterval(() => performance.clearMeasures(), CLEAR_EVERY_MS)
}
