/**
 * Whether a shell command kills processes it found by name or pattern rather
 * than by a PID it already holds.
 *
 * An agent stopping its own preview server ran
 *   Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*vite*' } | ... Stop-Process
 * which matched Ostler's own electron-vite and killed Ostler mid-session. The
 * agent never needs to do this: Ostler stops everything still running from its
 * workspace when the session ends. Killing one PID it started stays allowed.
 *
 * Self-contained on purpose: its source is embedded in the opencode plugin
 * (see ostler-plugin-template.ts), so it may not reference anything outside it.
 */
export function killsProcessesByPattern(command: string): boolean {
  const text = String(command || '').toLowerCase()
  const kills = /\b(stop-process|kill|taskkill|pkill|killall)\b|\.kill\(/.test(text)
  if (!kills) return false
  // Killing by name outright.
  if (/\bstop-process\b[^|;\n]*-name\b/.test(text)) return true
  if (/\btaskkill\b[^|;\n]*\/im\b/.test(text)) return true
  if (/\b(pkill|killall)\b/.test(text)) return true
  // Finding processes by query, then killing what matched.
  return /\b(get-process|gps|get-ciminstance|get-wmiobject|gwmi|wmic|tasklist|pgrep|ps\s+-|ps\s+aux)\b/.test(
    text
  )
}
