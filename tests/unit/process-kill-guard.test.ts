import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { execFileSync } from 'child_process'
import { killsProcessesByPattern } from '../../electron/services/opencode/process-kill-guard'
import { generateOstlerPluginJs } from '../../electron/services/opencode/ostler-plugin-template'

describe('killsProcessesByPattern', () => {
  it('refuses the command that killed Ostler, and other kill-by-pattern forms', () => {
    for (const command of [
      "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*vite*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
      'Get-Process node | Stop-Process -Force',
      'Stop-Process -Name node -Force',
      'taskkill /IM node.exe /F',
      'pkill -f vite',
      'killall node',
      'kill $(pgrep -f vite)'
    ])
      expect(killsProcessesByPattern(command), command).toBe(true)
  })
  it('allows ordinary commands and killing a PID the agent holds', () => {
    for (const command of [
      'npm run build',
      'git status --short',
      'Stop-Process -Id $server.Id -Force',
      'taskkill /PID 1234 /F',
      'kill 4242',
      'Get-Process | Select-Object -First 3'
    ])
      expect(killsProcessesByPattern(command), command).toBe(false)
  })
  it('works inside the generated plugin, where it runs as plain JS', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-plugin-'))
    const file = path.join(dir, 'plugin.mjs')
    fs.writeFileSync(file, generateOstlerPluginJs(dir, 0, 's', 'sess', 'proj'))
    const probe = [
      `const { OstlerPlugin } = await import(${JSON.stringify(pathToFileURL(file).href)});`,
      'const hooks = await OstlerPlugin({});',
      "const run = (command) => hooks['tool.execute.before']({ tool: 'bash' }, { args: { command } }).then(() => 'allowed', (e) => e.message);",
      "console.log(JSON.stringify([await run('Get-Process node | Stop-Process'), await run('git status')]));"
    ].join('\n')
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
      encoding: 'utf8'
    })
    const [killed, ordinary] = JSON.parse(out.trim().split('\n').pop()!)
    expect(killed).toMatch(/^Ostler guidance: do not stop processes/)
    expect(ordinary).toBe('allowed')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
