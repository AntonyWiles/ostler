import { describe, expect, it } from 'vitest'
import { processesInsideDirectory } from '../../electron/services/harness/workspace-processes'

const slot = 'C:\\Users\\me\\AppData\\Roaming\\ostler\\harness\\abc\\workspaces\\slot-1'

describe('processesInsideDirectory', () => {
  it('finds a detached dev server running out of the workspace node_modules', () => {
    const pids = processesInsideDirectory(
      [
        {
          pid: 10192,
          commandLine: `"node"   "${slot}\\node_modules\\.bin\\\\..\\vite\\bin\\vite.js" --port 4173 --strictPort`,
          executablePath: 'C:\\Program Files\\nodejs\\node.exe'
        },
        { pid: 20, commandLine: 'node C:\\other\\server.js', executablePath: null }
      ],
      slot,
      1
    )
    expect(pids).toEqual([10192])
  })

  it('matches case-insensitively and across slash styles, and by executable path', () => {
    const pids = processesInsideDirectory(
      [
        { pid: 5, commandLine: null, executablePath: `${slot.toLowerCase()}\\tool.exe` },
        { pid: 6, commandLine: `node ${slot.replace(/\\/g, '/')}/server.js`, executablePath: null }
      ],
      slot,
      1
    )
    expect(pids).toEqual([5, 6])
  })

  it('finds a server started with a relative path through the native module it loaded', () => {
    const pids = processesInsideDirectory(
      [
        {
          pid: 17616,
          commandLine:
            '"C:\\Program Files\\nodejs\\node.exe" node_modules/vite/bin/vite.js --port 4173',
          executablePath: 'C:\\Program Files\\nodejs\\node.exe',
          modulePath: `${slot}\\node_modules\\@rollup\\rollup-win32-x64-msvc\\rollup.win32-x64-msvc.node`
        }
      ],
      slot,
      1
    )
    expect(pids).toEqual([17616])
  })

  it('does not match a sibling slot whose name merely starts the same', () => {
    const pids = processesInsideDirectory(
      [{ pid: 7, commandLine: `node ${slot}0\\server.js`, executablePath: null }],
      slot,
      1
    )
    expect(pids).toEqual([])
  })

  it('never returns the calling process', () => {
    const pids = processesInsideDirectory(
      [{ pid: 99, commandLine: `node ${slot}\\x.js`, executablePath: null }],
      slot,
      99
    )
    expect(pids).toEqual([])
  })
})
