import { spawn, ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { isWithinRoot, normalizeAndResolve, sanitizePath } from '../paths'
import { t } from '@shared/i18n'

const MAX_READABLE_FILE_BYTES = 2 * 1024 * 1024
const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  '.cache',
  'coverage'
])

export interface CodeDirEntry {
  name: string
  relativePath: string
  isDirectory: boolean
}

/**
 * Resolves `relativePath` against `rootPath` and throws if the result would
 * land outside `rootPath` - the same traversal guard used elsewhere for
 * project-scoped file access, applied here to whichever root (project
 * checkout or harness session workspace) the renderer is currently browsing.
 */
function resolveWithinRoot(rootPath: string, relativePath: string): string {
  const cleaned = sanitizePath(relativePath || '.')
  const resolved = normalizeAndResolve(path.join(rootPath, cleaned))
  if (!isWithinRoot(resolved, rootPath)) {
    throw new Error('Path escapes the workspace root')
  }
  return resolved
}

export function listDirectory(rootPath: string, relativePath: string): CodeDirEntry[] {
  const target = resolveWithinRoot(rootPath, relativePath)
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(target, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        relativePath
          ? t('errors:codeWorkspaceService.folderNoLongerExists')
          : t('errors:codeWorkspaceService.workspaceNoLongerExists')
      )
    }
    throw error
  }
  return entries
    .filter((entry) => !EXCLUDED_DIR_NAMES.has(entry.name) && !entry.name.startsWith('.'))
    .map((entry) => ({
      name: entry.name,
      relativePath: path
        .join(relativePath || '', entry.name)
        .split(path.sep)
        .join('/'),
      isDirectory: entry.isDirectory()
    }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export function readWorkspaceFile(rootPath: string, relativePath: string): string {
  const target = resolveWithinRoot(rootPath, relativePath)
  let stat: fs.Stats
  try {
    stat = fs.statSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(t('errors:codeWorkspaceService.fileNoLongerExists'))
    }
    throw error
  }
  if (stat.isDirectory()) throw new Error(t('errors:codeWorkspaceService.cannotOpenDirectoryFile'))
  if (stat.size > MAX_READABLE_FILE_BYTES)
    throw new Error(t('errors:codeWorkspaceService.fileTooLargeOpen'))
  const buffer = fs.readFileSync(target)
  if (buffer.subarray(0, 8000).includes(0))
    throw new Error(t('errors:codeWorkspaceService.cannotOpenBinaryFile'))
  return buffer.toString('utf8')
}

export function writeWorkspaceFile(rootPath: string, relativePath: string, content: string): void {
  const target = resolveWithinRoot(rootPath, relativePath)
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    throw new Error(t('errors:codeWorkspaceService.cannotWriteDirectory'))
  }
  fs.writeFileSync(target, content, 'utf8')
}

type CommandChunkListener = (stream: 'stdout' | 'stderr', data: string) => void
type CommandExitListener = (code: number) => void

/**
 * Runs a shell command with streamed output. Not a PTY - no readline, no
 * ANSI-driven interactive programs - just a tracked child process whose
 * stdout/stderr are pushed to the caller as they arrive, so the renderer can
 * render it like a basic terminal scrollback pane.
 */
export class CommandRunner {
  private processes = new Map<string, ChildProcess>()

  run(
    runId: string,
    cwd: string,
    command: string,
    onChunk: CommandChunkListener,
    onExit: CommandExitListener
  ): void {
    if (this.processes.has(runId)) throw new Error(`Command ${runId} is already running`)
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: process.env
    })
    this.processes.set(runId, child)
    child.stdout?.on('data', (data: Buffer) => onChunk('stdout', data.toString('utf8')))
    child.stderr?.on('data', (data: Buffer) => onChunk('stderr', data.toString('utf8')))
    child.on('error', (error) => {
      onChunk('stderr', `${error.message}\n`)
      this.processes.delete(runId)
      onExit(-1)
    })
    child.on('close', (code) => {
      this.processes.delete(runId)
      onExit(code ?? -1)
    })
  }

  cancel(runId: string): boolean {
    const child = this.processes.get(runId)
    if (!child) return false
    child.kill()
    return true
  }
}
