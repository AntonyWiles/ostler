import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, type OstlerConfig } from '../../src/shared/ostler-api'
import {
  buildDiagnosticsText,
  configSecrets,
  countLogErrors,
  redactDiagnostics
} from '../../electron/app/diagnostics'
import { makeWatchedProject } from '../helpers/projects'

const AI_KEY = 'plain-provider-key-0000'
const config: OstlerConfig = {
  ...DEFAULT_CONFIG,
  ai: { ...DEFAULT_CONFIG.ai, apiKey: AI_KEY, provider: 'anthropic', model: 'm' },
  projects: [
    makeWatchedProject({
      id: 'p1',
      name: 'Secret Project Name',
      path: 'C:\\Users\\jordan\\code\\secret-project',
      color: '#000',
      automationToken: 'automation-token-2222'
    })
  ]
}

describe('diagnostics redaction', () => {
  const context = { userName: 'jordan', secrets: configSecrets(config) }

  it('removes every secret shape', () => {
    const text = [
      'path C:\\Users\\jordan\\AppData\\Roaming\\ostler\\ostler.db',
      'posix /home/jordan/projects and /Users/jordan/x',
      'header Authorization: Bearer abc.def-ghi_jkl',
      'openai sk-proj-AbCdEf123456789',
      'json {"apiKey":"zzz-unknown-key","harnessToken": "unknown-token-value"}',
      'env OSTLER_AI_API_KEY=some-env-value secret=hunter2',
      `verbatim ${AI_KEY} automation-token-2222`,
      'mention jordan said hi'
    ].join('\n')

    const redacted = redactDiagnostics(text, context)

    for (const secret of [
      'jordan',
      'abc.def-ghi_jkl',
      'AbCdEf123456789',
      'zzz-unknown-key',
      'unknown-token-value',
      'some-env-value',
      'hunter2',
      AI_KEY,
      'automation-token-2222'
    ]) {
      expect(redacted).not.toContain(secret)
    }
    expect(redacted).toContain('C:\\Users\\[user]\\AppData')
    expect(redacted).toContain('/home/[user]/projects')
  })

  it('builds a report with versions and counts but no names, paths or keys', () => {
    const text = buildDiagnosticsText(
      {
        appVersion: '0.1.0',
        versions: { electron: '43.0.0', chrome: '140', node: '22' },
        os: 'Windows 11 Pro (10.0.22631)',
        schemaVersion: 2,
        config,
        logLines: ['2026-10-08T00:00:00.000Z ERROR failed at C:\\Users\\jordan\\x Bearer tok-123']
      },
      context
    )

    expect(text).toContain('App version: 0.1.0')
    expect(text).toContain('Electron: 43.0.0')
    expect(text).toContain('OS: Windows 11 Pro (10.0.22631)')
    expect(text).toContain('Database schema version: 2')
    expect(text).toContain(`Config version: ${DEFAULT_CONFIG.configVersion}`)
    expect(text).toContain('Projects: 1')
    expect(text).toContain('AI configured: yes')
    expect(text).toContain('AI provider: anthropic')
    expect(text).not.toContain('Secret Project Name')
    expect(text).not.toContain('secret-project')
    expect(text).not.toContain(AI_KEY)
    expect(text).not.toContain('tok-123')
    expect(text).not.toContain('jordan')
  })
})

describe('countLogErrors', () => {
  it('counts only ERROR entries, not refusals logged at INFO or their stack lines', () => {
    expect(
      countLogErrors([
        '2026-10-11T10:00:00.000Z INFO IPC planning:update refused: Title is required',
        '2026-10-11T10:00:01.000Z ERROR IPC planning:list failed',
        'Error: database is locked',
        '    at Database.prepare (x.js:1:1)',
        '2026-10-11T10:00:02.000Z WARN Slow start-up'
      ])
    ).toBe(1)
  })
})
