import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawn } from 'child_process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const root = path.resolve(__dirname, '../..')

describe('Electron startup', () => {
  let dataDir: string

  afterEach(() => {
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('starts with a clean external OSTLER_USER_DATA directory', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-startup-'))
    const electronBinary = require('electron') as string
    const child = spawn(electronBinary, ['--no-sandbox', root], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        OSTLER_SMOKE_TEST: '1',
        OSTLER_USER_DATA: dataDir,
        ELECTRON_DISABLE_GPU: '1',
        // Never on screen; the test setup clears it from this process.
        OSTLER_OFF_SCREEN: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let output = ''
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Electron did not start within the timeout. Output:\n${output}`))
      }, 20_000)
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('close', (code) => {
        clearTimeout(timeout)
        resolve(code ?? -1)
      })
    })

    expect(output).toContain('OSTLER_READY')
    expect(exitCode).toBe(0)
    expect(fs.existsSync(path.join(dataDir, 'config.json'))).toBe(true)
    expect(fs.existsSync(path.join(dataDir, 'ostler.db'))).toBe(true)
    expect(fs.existsSync(path.join(root, '.agent-harness'))).toBe(false)
  }, 30_000)
})
