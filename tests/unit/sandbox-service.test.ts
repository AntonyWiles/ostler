import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  isSandboxSupported,
  labelPathLowIntegrity,
  isPathLowIntegrity,
  launchUnderSlotIdentity,
  readLauncherOutput
} from '../../electron/services/sandbox-service'

/** Whether the process `pid` is still running (EPERM: running, but not ours to signal). */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

describe.skipIf(process.platform !== 'win32')('sandbox-service.ts (Windows only)', () => {
  let tempDir: string
  let children: number[]

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-sandbox-'))
    children = []
  })

  afterEach(async () => {
    // A launched child runs in the folder and holds its output file open, and
    // Windows will not delete either while it runs. Under a full parallel test
    // run it can outlive the test by seconds, so wait for it to exit first.
    const deadline = Date.now() + 15_000
    while (children.some(isRunning) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    // The hidden console host Windows starts for the child shares its current
    // folder and can outlive it by a moment under load. While any process sits
    // in the folder, rmSync fails at once with EPERM: Node does not retry that
    // one, whatever maxRetries says. So try again until the folder is free.
    for (;;) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EPERM' || Date.now() > deadline) throw error
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }, 30_000)

  it('reports Windows as supported', () => {
    expect(isSandboxSupported).toBe(true)
  })

  it('labels a folder Low integrity and leaves siblings untouched', async () => {
    const slot = path.join(tempDir, 'slot')
    const sibling = path.join(tempDir, 'sibling')
    fs.mkdirSync(slot)
    fs.mkdirSync(sibling)

    expect(await isPathLowIntegrity(slot)).toBe(false)

    await labelPathLowIntegrity(slot)

    expect(await isPathLowIntegrity(slot)).toBe(true)
    expect(await isPathLowIntegrity(sibling)).toBe(false)
  })

  it('launches a headless child at Low integrity', async () => {
    const slot = path.join(tempDir, 'slot')
    const resultPath = path.join(slot, 'groups.txt')
    fs.mkdirSync(slot)
    await labelPathLowIntegrity(slot)

    const { pid } = await launchUnderSlotIdentity(
      process.env.ComSpec ?? 'cmd.exe',
      // By full path: a bare `whoami` can resolve to Git for Windows' msys copy
      // when its usr/bin is on PATH, and that one crashes at Low integrity.
      [
        '/d',
        '/c',
        `${path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe')} /groups`
      ],
      slot,
      { outputPath: resultPath }
    )
    expect(pid).toBeGreaterThan(0)
    children.push(pid)

    // Under a full parallel test run the child can take seconds to start, and
    // a partly written file is not an answer, so wait for the line itself.
    const lowLabel = /Mandatory Label\\Low Mandatory Level/i
    const readResult = () => (fs.existsSync(resultPath) ? fs.readFileSync(resultPath, 'utf8') : '')
    for (let attempt = 0; attempt < 300 && !lowLabel.test(readResult()); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(readResult()).toMatch(lowLabel)
  }, 20_000)
})

describe('readLauncherOutput', () => {
  /** A launcher whose events the test fires in the order a busy machine might. */
  function fakeLauncher() {
    return Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter()
    })
  }
  const settled = async (promise: Promise<string>) => {
    let state = 'pending'
    promise.then(
      () => (state = 'resolved'),
      () => (state = 'rejected')
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    return state
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits for the line when the launcher exits before its output is read', async () => {
    const launcher = fakeLauncher()
    const output = readLauncherOutput(launcher)
    launcher.emit('exit', 0)
    expect(await settled(output)).toBe('pending')
    launcher.stdout.emit('data', Buffer.from('12'))
    expect(await settled(output)).toBe('pending')
    launcher.stdout.emit('data', Buffer.from('345\r\n'))
    await expect(output).resolves.toBe('12345\r\n')
  })

  it('answers at exit when the line is already there, even while a grandchild holds the pipe', async () => {
    const launcher = fakeLauncher()
    const output = readLauncherOutput(launcher)
    launcher.stdout.emit('data', Buffer.from('4242\r\n'))
    expect(await settled(output)).toBe('pending')
    launcher.emit('exit', 0)
    await expect(output).resolves.toBe('4242\r\n')
  })

  it('answers with what there is when the stream ends, or the grace runs out', async () => {
    const ended = fakeLauncher()
    const endedOutput = readLauncherOutput(ended)
    ended.emit('exit', 0)
    ended.stdout.emit('end')
    await expect(endedOutput).resolves.toBe('')

    vi.useFakeTimers()
    const silent = fakeLauncher()
    const silentOutput = readLauncherOutput(silent, 1_000)
    silent.emit('exit', 0)
    await vi.advanceTimersByTimeAsync(999)
    expect(await Promise.race([silentOutput, Promise.resolve('still waiting')])).toBe(
      'still waiting'
    )
    await vi.advanceTimersByTimeAsync(1)
    await expect(silentOutput).resolves.toBe('')
  })

  it('fails with what the launcher said when it exits with an error', async () => {
    const launcher = fakeLauncher()
    const output = readLauncherOutput(launcher)
    launcher.stderr.emit('data', Buffer.from('CreateProcessAsUser failed: 5\r\n'))
    launcher.emit('exit', 1)
    await expect(output).rejects.toThrow(
      'powershell.exe exited with code 1: CreateProcessAsUser failed: 5'
    )
  })
})
