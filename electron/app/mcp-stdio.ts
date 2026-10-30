import { app } from 'electron'
import { copyFileSync, createReadStream, mkdirSync } from 'fs'
import { join } from 'path'
import type { McpStdioLaunch } from '@shared/agent-prompts'
import { MCP_STDIO_FLAG, readBridgeTarget, runStdioBridge } from '../services/mcp/stdio-bridge'
import { USER_DATA_ARGUMENT } from './data-dir'
import { openSecret } from '../safe-storage'

/**
 * How an MCP client starts this executable as a project's launcher. It must
 * find the same data folder: a development build passes it as an argument
 * (with the app's folder Electron needs), and a data folder chosen with
 * OSTLER_USER_DATA goes into the client's environment for it.
 */
export function mcpStdioLaunch(projectId: string, dataDir: string): McpStdioLaunch {
  const args = [MCP_STDIO_FLAG, '--project', projectId]
  if (!app.isPackaged) {
    return {
      command: process.execPath,
      args: [app.getAppPath(), ...args, `${USER_DATA_ARGUMENT}${dataDir}`]
    }
  }
  return {
    command: process.execPath,
    args,
    ...(process.env.OSTLER_USER_DATA ? { env: { OSTLER_USER_DATA: dataDir } } : {})
  }
}

/**
 * The file in which Chromium keeps the key safeStorage encrypts with (itself
 * protected by Windows for the signed-in user).
 */
const LOCAL_STATE = 'Local State'

/**
 * Gives the launcher's own userData folder (kept apart from the data folder
 * the running Ostler owns) a copy of the data folder's key file, so safeStorage
 * opens the tokens Ostler encrypted there. Called before the app is ready,
 * which is when Chromium reads it. A data folder without one has no
 * encrypted token to open.
 */
export function shareSecureStorageKey(dataDir: string, launcherUserData: string): void {
  try {
    mkdirSync(launcherUserData, { recursive: true })
    copyFileSync(join(dataDir, LOCAL_STATE), join(launcherUserData, LOCAL_STATE))
  } catch {
    // Nothing to share yet: the token check says what is missing.
  }
}

/**
 * The stdio launcher's process (D39): main.ts calls this instead of starting
 * Ostler when the arguments carry `--mcp-stdio`. It takes no single-instance
 * lock, opens no window, starts no service and never touches the database;
 * it bridges stdin and stdout to the running Ostler and exits when stdin ends.
 */
export function runMcpStdioLauncher(
  request: { projectId: string } | { error: string },
  dataDir: string
): void {
  // stdout carries MCP messages only: anything logged goes to stderr.
  for (const level of ['log', 'info', 'warn', 'debug'] as const) {
    console[level] = (...args: unknown[]) => console.error(...args)
  }
  if ('error' in request) {
    process.stderr.write(`${request.error}\n`)
    app.exit(2)
    return
  }
  const exit = (code: number) => process.stdout.write('', () => app.exit(code))
  // safeStorage opens the stored token only once the app is ready.
  app
    .whenReady()
    .then(() =>
      runStdioBridge({
        // Electron's process.stdin ends at once in the main process; the pipe a
        // client starts it with is still descriptor 0, so read that.
        input: createReadStream('', { fd: 0 }),
        output: process.stdout,
        target: () => readBridgeTarget(dataDir, request.projectId, openSecret)
      })
    )
    .then(
      () => exit(0),
      (error: unknown) => {
        console.error('MCP launcher failed:', error)
        exit(1)
      }
    )
}
