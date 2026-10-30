import type { WorkspaceSetupRecord } from './ostler-api/harness-types'

/**
 * Workspace setup: the one command Ostler runs in a new agent workspace before
 * the agent starts (usually a dependency install). This module is the single
 * source for what runs: the main process resolves it for real sessions, and
 * the Project settings preview calls the same function for the detected
 * command, so the two can never disagree.
 *
 * Pure: no filesystem access here. Callers read the root file names and pass
 * them in.
 */

export type AgentSetupSetting =
  { mode: 'auto' } | { mode: 'off' } | { mode: 'custom'; command: string }

export interface SetupInputs {
  /** File names at the repository root (not paths, not nested). */
  rootFiles: string[]
  /** The root package.json's `packageManager` field, e.g. `yarn@4.1.0`. */
  packageManagerField?: string
  hasYarnrcYml: boolean
}

export type ResolvedSetup =
  | { kind: 'none'; reason: 'off' | 'no-lockfile' }
  | { kind: 'run'; command: string; source: 'detected' | 'custom'; detectedFrom?: string }

interface DetectorRow {
  /**
   * The root file whose presence selects this row: a lockfile's exact name,
   * or a pattern for a family of files (a .NET solution has any name).
   */
  file: string | RegExp
  /** The command for the matched file, or null when this row does not apply. */
  command(inputs: SetupInputs, file: string): string | null
}

/** Yarn Berry (2+) is identified by `.yarnrc.yml` or a `packageManager` pin of yarn@2 or later. */
function isYarnBerry(inputs: SetupInputs): boolean {
  if (inputs.hasYarnrcYml) return true
  const major = /^yarn@(\d+)/.exec(inputs.packageManagerField ?? '')
  return major !== null && Number(major[1]) >= 2
}

/**
 * Detection, first matching row wins. Order matters only when a project has
 * several candidates: the earlier row names the one Ostler uses. Two rows
 * share `yarn.lock` and split it by Yarn generation: Berry's flag is
 * `--immutable`, Classic's is `--frozen-lockfile`, and each row returns null
 * for the other generation. .NET restores the solution at the root, or the
 * project when there is no solution; a repository with neither yet (one
 * whose first task creates them) runs nothing rather than a restore that
 * fails. Rust and Go need no row: they fetch dependencies when they build.
 * Anything else uses `custom`.
 */
const DETECTORS: readonly DetectorRow[] = [
  { file: 'pnpm-lock.yaml', command: () => 'pnpm install --frozen-lockfile' },
  { file: 'bun.lock', command: () => 'bun install --frozen-lockfile' },
  { file: 'bun.lockb', command: () => 'bun install --frozen-lockfile' },
  {
    file: 'yarn.lock',
    command: (inputs) => (isYarnBerry(inputs) ? 'yarn install --immutable' : null)
  },
  {
    file: 'yarn.lock',
    command: (inputs) => (isYarnBerry(inputs) ? null : 'yarn install --frozen-lockfile')
  },
  { file: 'package-lock.json', command: () => 'npm ci' },
  { file: 'npm-shrinkwrap.json', command: () => 'npm ci' },
  { file: 'uv.lock', command: () => 'uv sync --frozen' },
  { file: /\.slnx?$/i, command: (_inputs, file) => `dotnet restore "${file}"` },
  { file: /\.(?:cs|fs|vb)proj$/i, command: (_inputs, file) => `dotnet restore "${file}"` }
]

/** The root file a row matches, if any. Patterns take the first name in sorted order. */
function matchRow(row: DetectorRow, rootFiles: string[]): string | undefined {
  if (typeof row.file === 'string') return rootFiles.includes(row.file) ? row.file : undefined
  const pattern = row.file
  return [...rootFiles].sort().find((name) => pattern.test(name))
}

/** Resolves what runs for a project. Missing setting means `auto`. */
export function resolveWorkspaceSetup(
  setting: AgentSetupSetting | undefined,
  inputs: SetupInputs
): ResolvedSetup {
  if (setting?.mode === 'off') return { kind: 'none', reason: 'off' }
  if (setting?.mode === 'custom') {
    const command = setting.command.trim()
    if (!command) throw new Error('The custom setup command is empty')
    return { kind: 'run', command, source: 'custom' }
  }
  for (const row of DETECTORS) {
    const file = matchRow(row, inputs.rootFiles)
    if (!file) continue
    const command = row.command(inputs, file)
    if (command) return { kind: 'run', command, source: 'detected', detectedFrom: file }
  }
  return { kind: 'none', reason: 'no-lockfile' }
}

/**
 * Checks a setting arriving from the UI or the automation API. Whitespace-only
 * custom commands are refused here, so an invalid command is never saved.
 */
export function parseAgentSetup(value: unknown): AgentSetupSetting {
  if (!value || typeof value !== 'object') throw new Error('Workspace setup must be an object')
  const record = value as { mode?: unknown; command?: unknown }
  if (record.mode === 'auto' || record.mode === 'off') return { mode: record.mode }
  if (record.mode === 'custom') {
    if (typeof record.command !== 'string' || !record.command.trim()) {
      throw new Error('A custom workspace setup needs a command')
    }
    if (record.command.length > MAX_SETUP_COMMAND_LENGTH) {
      throw new Error(`A setup command can be at most ${MAX_SETUP_COMMAND_LENGTH} characters`)
    }
    return { mode: 'custom', command: record.command.trim() }
  }
  throw new Error('Workspace setup is Automatic, Custom or Off')
}

export const MAX_SETUP_COMMAND_LENGTH = 500

/**
 * The fact an agent is told about its workspace's setup, for the embedded
 * instructions and the external claim/session responses. English, because it
 * is text for models. Null when there is no record at all.
 */
export function describeWorkspaceSetup(record: WorkspaceSetupRecord | undefined): string | null {
  if (!record) return null
  switch (record.status) {
    case 'succeeded':
      return `Ostler ran \`${record.command ?? 'the setup command'}\` in this workspace before you started; dependencies are installed.`
    case 'skipped':
      if (record.skipReason === 'off') {
        return 'Setup is off for this project; Ostler did not install anything in this workspace.'
      }
      if (record.skipReason === 'no-lockfile') {
        return 'No setup ran: this project has no lockfile Ostler recognises, so nothing was installed.'
      }
      return 'No setup ran for this workspace.'
    case 'running':
      return 'Ostler is still preparing this workspace. Wait until its setup status leaves "running".'
    case 'failed':
      return `Ostler could not prepare this workspace: ${record.failure ?? 'setup failed'}.`
    case 'cancelled':
      return 'Ostler stopped preparing this workspace before it finished.'
  }
}
