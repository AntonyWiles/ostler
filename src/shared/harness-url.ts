/** Returns whether a value is a valid TCP port Ostler can bind its loopback API to. */
export function isHarnessPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
}

/**
 * Builds an agent-facing harness base URL. Keep this separate from view state
 * so a not-yet-loaded setting can never become the invalid `127.0.0.1:/...`.
 */
export function buildHarnessBaseUrl(port: number, projectId: string): string {
  if (!isHarnessPort(port)) throw new Error('Harness API port is unavailable')
  return `http://127.0.0.1:${port}/harness/${projectId}`
}

/** Builds the planning automation API base URL, e.g. for a copy-to-clipboard connection string. */
export function buildAutomationBaseUrl(port: number, projectId: string): string {
  if (!isHarnessPort(port)) throw new Error('Automation API port is unavailable')
  return `http://127.0.0.1:${port}/automation/${projectId}`
}
