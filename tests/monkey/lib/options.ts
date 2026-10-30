import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * What a monkey run does, read from MONKEY_* environment variables. The
 * `npm run monkey` launcher (scripts/monkey.cjs) turns its command-line flags
 * into these, so this is the one place their meaning and defaults live.
 */

export type MonkeyMode = 'journey' | 'explore' | 'whiteboard' | 'drive' | 'report'
/** Ostler AI: none, a local stand-in with canned answers, or the real provider. */
export type AiMode = 'off' | 'fake' | 'live'
/**
 * Coding agents: none; the monkey itself plays an external agent over the
 * harness HTTP API; Ostler's built-in agents do the work; or a real external
 * agent (started by a person or an overseer) does.
 */
export type AgentMode = 'off' | 'simulated' | 'embedded' | 'external'
/** Typing and thinking delays: none, short, or close to a person's. */
export type Speed = 'instant' | 'brisk' | 'human'
export type ShotPolicy = 'all' | 'phases' | 'errors'

export interface MonkeyOptions {
  mode: MonkeyMode
  runId: string
  /** The run folder: logs, screenshots, the report, and (unless reused) the data folder. */
  runDir: string
  /** OSTLER_USER_DATA for the app under test. Never your real data folder. */
  dataDir: string
  /** Where the dummy project's folder is created. */
  projectsDir: string
  /** True when the data folder is new: the app opens on its welcome. */
  fresh: boolean
  ai: AiMode
  /** Live AI: the guided setup's provider choice, e.g. "anthropic". */
  aiPreset: string
  /** Live AI: the model to pick, e.g. "claude-haiku-5-5"; empty keeps the setup's choice. */
  aiModel: string
  /** Live AI: the API key, typed into the setup and never written to any log. */
  aiKey: string
  agents: AgentMode
  seed: number
  /** Explore: the most actions to take. */
  steps: number
  /** Explore and live agent waits: the most minutes to spend. */
  minutes: number
  /** Journey: run only these phases (and nothing they depend on is re-run). */
  phases: string[] | null
  speed: Speed
  shots: ShotPolicy
  /** Run axe on each new screen. Slower, so off unless asked for. */
  a11y: boolean
  /** After a journey or exploration, keep the app open in drive mode. */
  keepOpen: boolean
  /** Drive mode's control port (loopback only); 0 picks a free one. */
  drivePort: number
  viewport: { width: number; height: number }
  /** Show the window on a display. Off by default: it opens off-screen and never takes focus. */
  onScreen: boolean
}

/** The scratch root every Ostler experiment uses (scripts/scratch-paths.cjs). */
export const SCRATCH_ROOT =
  process.platform === 'win32'
    ? 'C:\\temp\\ostler-roadmap'
    : path.join(os.tmpdir(), 'ostler-roadmap')

const MODES: readonly MonkeyMode[] = ['journey', 'explore', 'whiteboard', 'drive', 'report']
const AI_MODES: readonly AiMode[] = ['off', 'fake', 'live']
const AGENT_MODES: readonly AgentMode[] = ['off', 'simulated', 'embedded', 'external']
const SPEEDS: readonly Speed[] = ['instant', 'brisk', 'human']
const SHOT_POLICIES: readonly ShotPolicy[] = ['all', 'phases', 'errors']

function pick<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  if ((allowed as readonly string[]).includes(raw)) return raw as T
  throw new Error(`${name} must be one of ${allowed.join(', ')}; got ${JSON.stringify(raw)}`)
}

function number(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value))
    throw new Error(`${name} must be a number; got ${JSON.stringify(raw)}`)
  return value
}

function flag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function stamp(date = new Date()): string {
  const two = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
}

/**
 * Refuses your real data folder outright. A monkey presses Delete,
 * Restore and Remove project on purpose; it must only ever do that to a
 * folder made for it.
 */
export function assertScratchDataDir(dataDir: string): void {
  const resolved = path.resolve(dataDir).toLowerCase()
  const appData = process.env.APPDATA ? path.resolve(process.env.APPDATA).toLowerCase() : null
  if (appData && resolved.startsWith(appData)) {
    throw new Error(`Refusing to run the monkey against ${dataDir}: it is inside %APPDATA%`)
  }
  const scratch = path.resolve(SCRATCH_ROOT).toLowerCase()
  const temp = path.resolve(os.tmpdir()).toLowerCase()
  if (!resolved.startsWith(scratch) && !resolved.startsWith(temp)) {
    throw new Error(
      `Refusing to run the monkey against ${dataDir}: monkey data folders live under ${SCRATCH_ROOT} or the temp folder`
    )
  }
}

export function readOptions(): MonkeyOptions {
  const mode = pick('MONKEY_MODE', MODES, 'journey')
  const existingRun = process.env.MONKEY_RUN_DIR?.trim()
  const runId = existingRun ? path.basename(existingRun) : `${stamp()}-${mode}`
  const runDir = existingRun ? path.resolve(existingRun) : path.join(SCRATCH_ROOT, 'monkey', runId)
  const dataDir = path.join(runDir, 'data')
  assertScratchDataDir(dataDir)
  // A run folder that already holds a data folder is a continuation: same
  // projects, same agents, new session of the monkey.
  const fresh = !fs.existsSync(path.join(dataDir, 'config.json'))
  const [width, height] = (process.env.MONKEY_VIEWPORT?.trim() || '1440x900')
    .split('x')
    .map((part) => Number(part))
  const phases = process.env.MONKEY_PHASES?.trim()
  return {
    mode,
    runId,
    runDir,
    dataDir,
    projectsDir: path.join(runDir, 'projects'),
    fresh,
    ai: pick('MONKEY_AI', AI_MODES, 'fake'),
    aiPreset: process.env.MONKEY_AI_PRESET?.trim() || 'anthropic',
    aiModel: process.env.MONKEY_AI_MODEL?.trim() || '',
    aiKey: process.env.MONKEY_AI_KEY?.trim() || '',
    agents: pick('MONKEY_AGENTS', AGENT_MODES, 'simulated'),
    seed: number('MONKEY_SEED', Date.now() % 100000),
    steps: number('MONKEY_STEPS', 300),
    minutes: number('MONKEY_MINUTES', mode === 'explore' ? 15 : 90),
    phases: phases
      ? phases
          .split(',')
          .map((phase) => phase.trim())
          .filter(Boolean)
      : null,
    speed: pick('MONKEY_SPEED', SPEEDS, 'brisk'),
    shots: pick('MONKEY_SHOTS', SHOT_POLICIES, 'all'),
    a11y: flag('MONKEY_A11Y', false),
    keepOpen: flag('MONKEY_KEEP_OPEN', mode === 'drive'),
    drivePort: number('MONKEY_DRIVE_PORT', 0),
    viewport: {
      width: Number.isFinite(width) && width > 0 ? width : 1440,
      height: Number.isFinite(height) && height > 0 ? height : 900
    },
    onScreen: flag('MONKEY_ON_SCREEN', false)
  }
}

/** The options as they go into the report: no key, ever. */
export function describeOptions(options: MonkeyOptions): Record<string, unknown> {
  const { aiKey, ...rest } = options
  return { ...rest, aiKey: aiKey ? '(set)' : '(not set)' }
}
