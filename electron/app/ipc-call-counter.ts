/**
 * Development-only IPC call counter, for measuring how chatty the renderer is.
 *
 * Off unless the main process starts with `OSTLER_COUNT_IPC=1`. When on, every
 * `handleIpc` channel invocation is counted and, once a minute, the total and
 * the busiest channels are written to stdout (the `npm run dev` terminal).
 * It never runs in a normal launch, so it costs nothing there.
 *
 * The running totals since start-up are also kept on
 * `globalThis.__ostlerIpcCalls` (channel to count), which the perf suite reads
 * from the main process to count idle calls per minute (P9.1).
 */
const WINDOW_MS = 60_000

const enabled = process.env.OSTLER_COUNT_IPC === '1'
let counts = new Map<string, number>()
let timer: ReturnType<typeof setInterval> | null = null
const totals = new Map<string, number>()
if (enabled) (globalThis as { __ostlerIpcCalls?: Map<string, number> }).__ostlerIpcCalls = totals

function report(): void {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
  const top = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([channel, count]) => `${channel}=${count}`)
    .join(' ')
  console.log(`[ipc-count] ${total} calls in the last minute: ${top}`)
  counts = new Map()
}

export function countIpcCall(channel: string): void {
  if (!enabled) return
  if (!timer) {
    timer = setInterval(report, WINDOW_MS)
    timer.unref?.()
  }
  counts.set(channel, (counts.get(channel) ?? 0) + 1)
  totals.set(channel, (totals.get(channel) ?? 0) + 1)
}
