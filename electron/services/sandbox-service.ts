import { execFile, spawn } from 'child_process'
import { relative, resolve } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** The launcher's own pipes and events, as `readLauncherOutput` reads them (a ChildProcess). */
export interface LauncherProcess {
  stdout: NodeJS.EventEmitter
  stderr: NodeJS.EventEmitter
  on(event: 'exit', listener: (code: number | null) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

/** How long to wait, after the launcher exits, for the line it wrote to arrive. */
export const LAUNCHER_OUTPUT_GRACE_MS = 5_000

/**
 * Reads what the launcher PowerShell wrote to stdout, once *it* has exited and
 * its line has arrived. `CreateProcessAsUser` in that script passes
 * `bInheritHandles = TRUE` (required so the grandchild inherits the NUL/output
 * file handles built for it) - but that also duplicates Node's own stdout pipe
 * for this powershell.exe into the grandchild. When the grandchild is a
 * long-lived server (as opposed to a terminal shell that exits with the
 * session), it holds that pipe open indefinitely, so the stream may never end
 * and waiting for it would hang forever: the process's own `exit` event says
 * when the launcher is done. But `exit` can come before the last of its output
 * has been read from the pipe (a busy machine makes that likely), and resolving
 * then gave "invalid process ID: (empty)". So a successful exit waits for the
 * line itself, or the end of the stream, or `graceMs` if neither ever comes.
 */
export function readLauncherOutput(
  child: LauncherProcess,
  graceMs = LAUNCHER_OUTPUT_GRACE_MS
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let stdout = ''
    let stderr = ''
    let exitCode: number | null | undefined
    let ended = false
    let graceOver = false
    let settled = false
    let grace: ReturnType<typeof setTimeout> | undefined
    const finish = (error: Error | null) => {
      settled = true
      clearTimeout(grace)
      if (error) reject(error)
      else resolvePromise(stdout)
    }
    const settle = () => {
      if (settled || exitCode === undefined) return
      if (exitCode !== 0) {
        finish(
          new Error(
            `powershell.exe exited with code ${exitCode}: ${stderr.trim() || stdout.trim()}`
          )
        )
      } else if (stdout.includes('\n') || ended || graceOver) {
        finish(null)
      }
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      settle()
    })
    child.stdout.on('end', () => {
      ended = true
      settle()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      if (!settled) finish(error)
    })
    child.on('exit', (code) => {
      exitCode = code
      grace = setTimeout(() => {
        graceOver = true
        settle()
      }, graceMs)
      settle()
    })
  })
}

function runPowershellCapturingStdout(args: readonly string[]): Promise<string> {
  return readLauncherOutput(spawn('powershell.exe', args, { windowsHide: true }))
}

/**
 * Windows-only OS-level write boundary for agent session workspaces, using
 * Mandatory Integrity Control. A folder labeled Low integrity can still be
 * READ by any normal (Medium) process - MIC only restricts writes - but a
 * process that is itself running at Low integrity can only WRITE inside
 * folders also labeled Low. Everything else (sibling session workspaces, the
 * real project) stays at the default Medium label and rejects writes from a
 * Low-integrity process with a genuine Access Denied.
 *
 * Uses Windows integrity labels to enforce the write boundary.
 */
export const isSandboxSupported = process.platform === 'win32'

export interface LowIntegrityLaunchResult {
  /** Windows process ID assigned by CreateProcessAsUser. */
  pid: number
}

export interface LowIntegrityLaunchOptions {
  /** Optional diagnostic file, restricted to the session slot. */
  outputPath?: string
  /** Per-child environment overrides; values are never persisted by this launcher. */
  environment?: Readonly<Record<string, string>>
}

/**
 * Quotes one argument using the CommandLineToArgvW-compatible convention.
 * Keeping this separate from the PowerShell bootstrapper means callers never
 * concatenate an untrusted command line themselves.
 */
export function quoteWindowsCommandArgument(argument: string): string {
  if (argument.length > 0 && !/[\s"]/u.test(argument)) return argument
  return `"${argument.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\*)$/u, '$1$1')}"`
}

function buildLowIntegrityLaunchScript(
  command: string,
  args: readonly string[],
  cwd: string,
  outputPath: string | undefined,
  environment: Readonly<Record<string, string>>
): string {
  const commandLine = [command, ...args].map(quoteWindowsCommandArgument).join(' ')
  const environmentAssignments = Object.entries(environment)
    .map(([key, value]) => `$env:${key} = '${value.replace(/'/gu, "''")}'`)
    .join('\n')
  // This is deliberately a short-lived bootstrapper. It duplicates Ostler's
  // token, changes only its Mandatory Integrity Level, and uses that primary
  // token for the child. The child is therefore free to read normal user
  // resources but MIC prevents writes outside its Low-labelled slot.
  return `$ErrorActionPreference = 'Stop'
Add-Type -Namespace OstlerSandbox -Name Native -MemberDefinition @'
[DllImport("advapi32.dll", SetLastError = true)]
public static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);
[DllImport("kernel32.dll")]
public static extern IntPtr GetCurrentProcess();
public enum SECURITY_IMPERSONATION_LEVEL { Anonymous, Identification, Impersonation, Delegation }
public enum TOKEN_TYPE { TokenPrimary = 1, TokenImpersonation }
[DllImport("advapi32.dll", SetLastError = true)]
public static extern bool DuplicateTokenEx(IntPtr hExistingToken, uint dwDesiredAccess, IntPtr lpTokenAttributes, SECURITY_IMPERSONATION_LEVEL ImpersonationLevel, TOKEN_TYPE TokenType, out IntPtr phNewToken);
[DllImport("advapi32.dll", SetLastError = true)]
public static extern bool SetTokenInformation(IntPtr TokenHandle, int TokenInformationClass, IntPtr TokenInformation, uint TokenInformationLength);
[StructLayout(LayoutKind.Sequential)]
public struct STARTUPINFO { public int cb; public string lpReserved; public string lpDesktop; public string lpTitle; public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute; public int dwFlags; public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError; }
[StructLayout(LayoutKind.Sequential)]
public struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }
[StructLayout(LayoutKind.Sequential)]
public struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public bool bInheritHandle; }
[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool CreateProcessAsUser(IntPtr hToken, string lpApplicationName, System.Text.StringBuilder lpCommandLine, IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory, ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern IntPtr CreateFile(string lpFileName, uint dwDesiredAccess, uint dwShareMode, ref SECURITY_ATTRIBUTES lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool CloseHandle(IntPtr hObject);
'@
${environmentAssignments}
$TOKEN_ALL_ACCESS = 0xF01FF
$TokenIntegrityLevel = 25
$SE_GROUP_INTEGRITY = 0x20
[IntPtr]$token = [IntPtr]::Zero
[IntPtr]$lowToken = [IntPtr]::Zero
[IntPtr]$label = [IntPtr]::Zero
[IntPtr]$nullIn = [IntPtr]::Zero
[IntPtr]$nullOut = [IntPtr]::Zero
try {
  if (-not [OstlerSandbox.Native]::OpenProcessToken([OstlerSandbox.Native]::GetCurrentProcess(), $TOKEN_ALL_ACCESS, [ref]$token)) { throw "OpenProcessToken failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  if (-not [OstlerSandbox.Native]::DuplicateTokenEx($token, $TOKEN_ALL_ACCESS, [IntPtr]::Zero, [OstlerSandbox.Native+SECURITY_IMPERSONATION_LEVEL]::Impersonation, [OstlerSandbox.Native+TOKEN_TYPE]::TokenPrimary, [ref]$lowToken)) { throw "DuplicateTokenEx failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  $sid = [Security.Principal.SecurityIdentifier]::new('S-1-16-4096')
  $bytes = [byte[]]::new($sid.BinaryLength)
  $sid.GetBinaryForm($bytes, 0)
  $headerSize = [IntPtr]::Size + 8
  $label = [Runtime.InteropServices.Marshal]::AllocHGlobal($headerSize + $bytes.Length)
  $sidPtr = [IntPtr]::Add($label, $headerSize)
  [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $sidPtr, $bytes.Length)
  [Runtime.InteropServices.Marshal]::WriteIntPtr($label, 0, $sidPtr)
  [Runtime.InteropServices.Marshal]::WriteInt32($label, [IntPtr]::Size, $SE_GROUP_INTEGRITY)
  if (-not [OstlerSandbox.Native]::SetTokenInformation($lowToken, $TokenIntegrityLevel, $label, $headerSize + $bytes.Length)) { throw "SetTokenInformation(TokenIntegrityLevel) failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  $security = [OstlerSandbox.Native+SECURITY_ATTRIBUTES]::new()
  $security.nLength = [Runtime.InteropServices.Marshal]::SizeOf($security)
  $security.bInheritHandle = $true
  [uint32]$genericRead = 2147483648
  [uint32]$genericWrite = 1073741824
  $nullIn = [OstlerSandbox.Native]::CreateFile('NUL', $genericRead, 1, [ref]$security, 3, 0x80, [IntPtr]::Zero)
  $nullOut = [OstlerSandbox.Native]::CreateFile('${(outputPath ?? 'NUL').replace(/'/gu, "''")}', $genericWrite, 1, [ref]$security, ${outputPath ? '2' : '3'}, 0x80, [IntPtr]::Zero)
  if ($nullIn -eq [IntPtr](-1) -or $nullOut -eq [IntPtr](-1)) { throw "CreateFile(NUL) failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  $si = [OstlerSandbox.Native+STARTUPINFO]::new()
  $si.cb = [Runtime.InteropServices.Marshal]::SizeOf($si)
  $si.dwFlags = 0x100
  $si.hStdInput = $nullIn
  $si.hStdOutput = $nullOut
  $si.hStdError = $nullOut
  $pi = [OstlerSandbox.Native+PROCESS_INFORMATION]::new()
  $line = [Text.StringBuilder]::new('${commandLine.replace(/'/gu, "''")}')
  if (-not [OstlerSandbox.Native]::CreateProcessAsUser($lowToken, '${command.replace(/'/gu, "''")}', $line, [IntPtr]::Zero, [IntPtr]::Zero, $true, 0x08000000, [IntPtr]::Zero, '${cwd.replace(/'/gu, "''")}', [ref]$si, [ref]$pi)) { throw "CreateProcessAsUser failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  try { [Console]::Out.WriteLine($pi.dwProcessId) } finally { [OstlerSandbox.Native]::CloseHandle($pi.hProcess) | Out-Null; [OstlerSandbox.Native]::CloseHandle($pi.hThread) | Out-Null }
} finally {
  if ($label -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($label) }
  if ($lowToken -ne [IntPtr]::Zero) { [OstlerSandbox.Native]::CloseHandle($lowToken) | Out-Null }
  if ($nullOut -ne [IntPtr]::Zero -and $nullOut -ne [IntPtr](-1)) { [OstlerSandbox.Native]::CloseHandle($nullOut) | Out-Null }
  if ($nullIn -ne [IntPtr]::Zero -and $nullIn -ne [IntPtr](-1)) { [OstlerSandbox.Native]::CloseHandle($nullIn) | Out-Null }
  if ($token -ne [IntPtr]::Zero) { [OstlerSandbox.Native]::CloseHandle($token) | Out-Null }
}`
}

/**
 * Starts a headless child process using a duplicate of Ostler's token lowered
 * to Low integrity. `cwd` must be the session's already Low-labelled slot.
 * This is the common launch primitive for an interactive session terminal and
 * for headless embedded runners.
 */
export async function launchUnderSlotIdentity(
  command: string,
  args: readonly string[],
  cwd: string,
  options: LowIntegrityLaunchOptions = {}
): Promise<LowIntegrityLaunchResult> {
  if (!isSandboxSupported)
    throw new Error('Low-integrity process launch is only supported on Windows')
  if (!command) throw new Error('A command is required')
  if (!cwd) throw new Error('A working directory is required')
  const slotRoot = resolve(cwd)
  const outputPath = options.outputPath ? resolve(options.outputPath) : undefined
  if (outputPath && relative(slotRoot, outputPath).startsWith('..')) {
    throw new Error('Low-integrity launcher output must stay within the session slot')
  }
  const environment = options.environment ?? {}
  for (const [key, value] of Object.entries(environment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key))
      throw new Error(`Invalid environment variable name: ${key}`)
    if (value.includes('\0')) throw new Error(`Environment variable ${key} contains a NUL byte`)
  }
  const encoded = Buffer.from(
    buildLowIntegrityLaunchScript(command, args, slotRoot, outputPath, environment),
    'utf16le'
  ).toString('base64')
  const stdout = await runPowershellCapturingStdout([
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encoded
  ])
  const pid = Number.parseInt(stdout.trim(), 10)
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(
      `Low-integrity launcher returned an invalid process ID: ${stdout.trim() || '(empty)'}`
    )
  }
  return { pid }
}

async function grantSelfFullControl(targetPath: string): Promise<void> {
  const domain = process.env.USERDOMAIN
  const user = process.env.USERNAME
  if (!domain || !user) throw new Error('Could not determine the current Windows account')
  // This environment's default folder permissions can be Modify-only (no
  // WRITE_DAC), which blocks setting a mandatory label - it lives in the
  // object's SACL, not its DACL. Grant Full Control to self first; harmless
  // no-op if the account already has it.
  await execFileAsync('icacls', [targetPath, '/grant', `${domain}\\${user}:(OI)(CI)F`])
}

/**
 * Labels `targetPath` (and everything created under it) Low integrity.
 * Best-effort by design: a workspace is fully usable without this label, it
 * just means the write boundary isn't active for it. Callers should log
 * failures rather than treat them as fatal to session creation.
 */
export async function labelPathLowIntegrity(targetPath: string): Promise<void> {
  if (!isSandboxSupported) return
  await grantSelfFullControl(targetPath)
  await execFileAsync('icacls', [targetPath, '/setintegritylevel', '(OI)(CI)L'])
}

/** True if `targetPath` currently carries a Low integrity mandatory label. */
export async function isPathLowIntegrity(targetPath: string): Promise<boolean> {
  if (!isSandboxSupported) return false
  try {
    const { stdout } = await execFileAsync('icacls', [targetPath])
    return /Mandatory Label\\Low Mandatory Level/i.test(stdout)
  } catch {
    return false
  }
}
