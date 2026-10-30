import { execFile } from 'child_process'

/**
 * Stops processes an agent left running out of its session workspace.
 *
 * Killing the agent's own process tree is not enough: agents routinely start
 * dev servers detached (`Start-Process`, `start /b`, `nohup ... &`), which puts
 * them outside that tree. A server left like that keeps its port, and on
 * Windows it holds files open, so the worktree folder cannot be removed and
 * the session gets stuck in review. These processes are found by where they
 * run from (a command line or executable inside the workspace), not by who
 * started them.
 */

export interface ProcessInfo {
  pid: number
  commandLine: string | null
  executablePath: string | null
  /**
   * Windows: a module the process has loaded from inside the directory. A
   * server started with a relative path (`node node_modules/vite/bin/vite.js`
   * from the workspace) names no workspace path on its command line, but its
   * native modules (rollup's .node, esbuild's) are loaded from there -- and
   * those are exactly what keep the folder from being deleted.
   */
  modulePath?: string | null
}

function normalize(value: string): string {
  return value.replace(/\\+/g, '/').toLowerCase()
}

/**
 * Pure: the processes whose command line or executable refers to a path inside
 * `dir`. A match must end at a path boundary, so `slot-1` never matches `slot-10`.
 */
export function processesInsideDirectory(
  processes: readonly ProcessInfo[],
  dir: string,
  selfPid: number = process.pid
): number[] {
  const root = normalize(dir).replace(/\/+$/, '')
  if (!root) return []
  const boundary = new RegExp(`${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[/"'\\s])`)
  return processes
    .filter((proc) => proc.pid !== selfPid && proc.pid > 0)
    .filter((proc) =>
      [proc.commandLine, proc.executablePath, proc.modulePath].some(
        (text) => !!text && boundary.test(normalize(text))
      )
    )
    .map((proc) => proc.pid)
}

function run(file: string, args: string[], env?: Record<string, string>): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        env: env ? { ...process.env, ...env } : process.env
      },
      (_error, stdout) => resolve(stdout ?? '')
    )
  })
}

// The directory arrives through the environment, so no path needs quoting
// inside the script. Modules are only looked up for processes whose command
// line does not already name the directory, and only the first match is kept.
// Walking every process's modules took seconds; the runtimes that start dev
// servers and load native modules from node_modules are the ones that matter.
const WINDOWS_PROCESS_QUERY = [
  '$dir = $env:OSTLER_SWEEP_DIR.TrimEnd("\\") + "\\"',
  '$modules = @{}',
  'foreach ($p in Get-Process -Name node, esbuild, bun, deno, python, pythonw, java -ErrorAction SilentlyContinue) { try { foreach ($m in $p.Modules) { if ($m.FileName -and $m.FileName.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase)) { $modules[$p.Id] = $m.FileName; break } } } catch {} }',
  'Get-CimInstance Win32_Process | Select-Object @{n="pid";e={$_.ProcessId}},@{n="commandLine";e={$_.CommandLine}},@{n="executablePath";e={$_.ExecutablePath}},@{n="modulePath";e={$modules[[int]$_.ProcessId]}} | ConvertTo-Json -Compress'
].join('; ')

async function listProcesses(dir: string): Promise<ProcessInfo[]> {
  if (process.platform === 'win32') {
    const out = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROCESS_QUERY],
      { OSTLER_SWEEP_DIR: dir.replace(/\//g, '\\') }
    )
    try {
      const parsed = JSON.parse(out) as ProcessInfo | ProcessInfo[]
      return Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      return []
    }
  }
  const out = await run('ps', ['-eo', 'pid=,args='])
  return out
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
    .filter((match): match is RegExpMatchArray => !!match)
    .map((match) => ({ pid: Number(match[1]), commandLine: match[2], executablePath: null }))
}

/** Best-effort: never throws, because cleanup must not block ending a session. */
export async function stopWorkspaceProcesses(dir: string): Promise<number[]> {
  try {
    const pids = processesInsideDirectory(await listProcesses(dir), dir)
    for (const pid of pids) {
      if (process.platform === 'win32') {
        await run('taskkill', ['/pid', String(pid), '/t', '/f'])
      } else {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          // Already gone.
        }
      }
    }
    return pids
  } catch {
    return []
  }
}

/**
 * Kills one process and every process it started. Taskkill's `/t` is the
 * Windows tree kill: `npm` starts `node`, which starts a shell, which starts
 * the installer's own children, and killing only the root leaves them running
 * in the workspace. Best-effort, like the sweep above.
 */
export async function killProcessTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await run('taskkill', ['/pid', String(pid), '/t', '/f'])
    return
  }
  // Non-Windows children are spawned as their own process group (detached).
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }
}
