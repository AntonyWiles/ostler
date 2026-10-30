import type { OstlerConfig } from '@shared/ostler-api'
import { BRAND } from '@shared/brand'

/**
 * The text behind Settings › About › Copy diagnostics: what a user pastes into
 * a bug report. It names no project and carries no secret. Nothing is sent
 * anywhere (D12); the user decides where it goes.
 */
export interface DiagnosticsFacts {
  appVersion: string
  versions: { electron?: string; chrome?: string; node?: string }
  /** e.g. "Windows 11 Pro (10.0.22631)". */
  os: string
  schemaVersion: number
  config: OstlerConfig
  /** The last lines of main.log, oldest first. */
  logLines: string[]
}

export interface RedactionContext {
  /** The signed-in user's name, as it appears in paths. */
  userName: string
  /** Exact secrets to remove wherever they appear (the AI key, project tokens). */
  secrets: string[]
}

export function buildDiagnosticsText(facts: DiagnosticsFacts, redaction: RedactionContext): string {
  const { config } = facts
  const autoDispatchProjects = config.projects.filter((project) => project.autoDispatch?.enabled)
  const text = [
    `${BRAND.fullName} diagnostics`,
    `Generated: ${new Date().toISOString()}`,
    '',
    `App version: ${facts.appVersion}`,
    `Electron: ${facts.versions.electron ?? 'unknown'}`,
    `Chrome: ${facts.versions.chrome ?? 'unknown'}`,
    `Node: ${facts.versions.node ?? 'unknown'}`,
    `OS: ${facts.os}`,
    '',
    `Database schema version: ${facts.schemaVersion}`,
    `Config version: ${config.configVersion}`,
    `Projects: ${config.projects.length}`,
    '',
    `AI configured: ${config.ai.apiKey && config.ai.model ? 'yes' : 'no'}`,
    `AI provider: ${config.ai.provider}`,
    `Agent harness API: ${config.harness.enabled ? 'on' : 'off'}`,
    `Automation API: ${config.automationApi.enabled ? 'on' : 'off'}`,
    `Projects with auto-dispatch on: ${autoDispatchProjects.length}`,
    '',
    // Refusals (a validation message, a conflicting merge) are logged at INFO,
    // so this counts only what actually went wrong.
    `Errors in these lines: ${countLogErrors(facts.logLines)}`,
    `Last ${facts.logLines.length} lines of main.log:`,
    ...facts.logLines
  ].join('\n')
  return redactDiagnostics(text, redaction)
}

/** The ERROR entries among main.log lines (`<ISO time> ERROR <message>`). */
export function countLogErrors(lines: string[]): number {
  return lines.filter((line) => /^\S+ ERROR /.test(line)).length
}

/** Every secret a config holds, for exact-match redaction. */
export function configSecrets(config: OstlerConfig): string[] {
  return [
    config.ai.apiKey,
    ...config.projects.map((project) => project.automationToken ?? '')
  ].filter((secret) => secret.length > 0)
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Removes what must never leave the machine in a pasted report: the user's
 * name in paths, bearer tokens, `sk-…` style keys, the value of any field
 * named like a key or token, and each known secret verbatim.
 */
export function redactDiagnostics(text: string, { userName, secrets }: RedactionContext): string {
  let redacted = text
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret) redacted = redacted.split(secret).join('[redacted]')
  }
  redacted = redacted
    .replace(/(Bearer\s+)[^\s"',;]+/gi, '$1[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-[redacted]')
    .replace(
      /(\b[\w-]*(?:key|token|secret|password)[\w-]*["']?\s*[:=]\s*["']?)(?!\[redacted\])[^\s"',;}]+/gi,
      '$1[redacted]'
    )
    // Home folders on Windows, macOS and Linux, whoever the user is.
    .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"']+/gi, '$1[user]')
    .replace(/(\/(?:Users|home)\/)[^/\s"']+/g, '$1[user]')
  if (userName.length >= 2) {
    redacted = redacted.replace(new RegExp(`\\b${escapeRegExp(userName)}\\b`, 'gi'), '[user]')
  }
  return redacted
}
