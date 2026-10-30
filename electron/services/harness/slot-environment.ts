import * as path from 'path'
import { mkdir } from 'fs/promises'
import { labelPathLowIntegrity } from '../sandbox-service'

/**
 * The environment every process run in an agent workspace shares: the
 * dependency installer during workspace setup, and the embedded opencode
 * runner. Everything here is non-secret. The runner adds its own secrets
 * (server password, bridge secret, provider API key) on top; setup never
 * gets them, because dependency `postinstall` scripts run with its environment.
 */

/**
 * Runtime state must never live inside the Git worktree: it can contain
 * caches, provider configuration, and generated files that are not agent
 * deliverables. Keep it beside Ostler's worktree pool instead.
 */
export function slotRuntimeHome(slotPath: string): string {
  return path.join(
    path.dirname(path.dirname(slotPath)),
    'runtime',
    path.basename(slotPath),
    'opencode-home'
  )
}

/**
 * The parent environment minus everything that would reach into another
 * repository.
 *
 * An agent's process runs inside an isolated worktree, and it runs git there
 * constantly -- opencode snapshots the workspace between turns. Handing it the
 * whole of `process.env` handed it Ostler's own `GIT_DIR`/`GIT_WORK_TREE` too,
 * which point at a different repository entirely, so git inside the slot
 * answered every call with errors like `fatal: '$GIT_DIR' too big` and the
 * agent's snapshots silently failed. Git's own environment is per-repository
 * state, not inheritable configuration; a fresh worktree must discover its own.
 *
 * Provider base URLs go too. Ostler's settings choose the endpoint, but the AI
 * SDK packages opencode loads read `ANTHROPIC_BASE_URL` and friends on their
 * own and expect them to end in `/v1`. Launched from a shell that set
 * `ANTHROPIC_BASE_URL=https://api.anthropic.com` (Claude Code does), every
 * request went to `/messages` instead of `/v1/messages` and failed 404.
 */
const PROVIDER_BASE_URL_ENV = /^(ANTHROPIC|OPENAI|GOOGLE_GENERATIVE_AI)_BASE_URL$/

export function inheritableEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith('GIT_') && !PROVIDER_BASE_URL_ENV.test(key)
    )
  )
}

/**
 * The slot-local XDG/HOME redirection and cache and temp folders. Nothing
 * here is a secret.
 */
export function slotBaseEnvironment(slotPath: string): Record<string, string> {
  const home = slotRuntimeHome(slotPath)
  return {
    XDG_DATA_HOME: path.join(home, 'data'),
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_CACHE_HOME: path.join(home, 'cache'),
    XDG_STATE_HOME: path.join(home, 'state'),
    HOME: home,
    USERPROFILE: home,
    // opencode installs a provider's ai-sdk adapter package (e.g.
    // @ai-sdk/openai-compatible for CUSTOM_PROVIDER_ID) via npm at runtime.
    // Keeping the npm cache slot-local avoids concurrent sessions racing on or
    // polluting a shared npm cache, and it survives between sessions on a slot.
    npm_config_cache: path.join(home, 'npm-cache'),
    // Inherited from Ostler, these point at the user's %TEMP%, where esbuild
    // (so every Vite build) failed with "Access is denied" removing its own
    // temp files. Beside the slot, never inside the worktree, so nothing here
    // is committed.
    TEMP: path.join(home, 'tmp'),
    TMP: path.join(home, 'tmp'),
    TMPDIR: path.join(home, 'tmp')
  }
}

/**
 * Creates the slot's temp folder and labels it Low, the same as the worktree.
 * Must run before any tool that uses TEMP does, and it is best-effort: a
 * failed label is logged and the run goes on without it.
 */
export async function prepareSlotEnvironment(
  slotPath: string,
  log: (message: string) => void = () => {}
): Promise<void> {
  const tempDir = slotBaseEnvironment(slotPath).TEMP
  await mkdir(tempDir, { recursive: true })
  try {
    await labelPathLowIntegrity(tempDir)
  } catch (error) {
    log(`warning: could not label the temp folder Low: ${String(error)}`)
  }
}
