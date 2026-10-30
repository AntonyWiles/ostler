import { describe, expect, it } from 'vitest'
import {
  isLocalAddress,
  MAX_TRY_COMMAND_LENGTH,
  needsTryWarning,
  outputSegments,
  parseSuggestedTryCommand,
  parseTryCommand,
  stripTerminalCodes,
  trimOutput,
  TRY_OUTPUT_LINES
} from '../../src/shared/try-it'
import { parseReportExtras } from '../../src/shared/agent-report-extras'

describe('try command (N9.4)', () => {
  it('saves one trimmed line and clears with an empty one', () => {
    expect(parseTryCommand('  npm run dev  ')).toBe('npm run dev')
    expect(parseTryCommand('')).toBe('')
    expect(parseTryCommand('   ')).toBe('')
  })

  it('refuses more than one line, control characters, too long, or not text', () => {
    expect(() => parseTryCommand('npm ci\nnpm run dev')).toThrow(/one line/)
    expect(() => parseTryCommand('npm run dev\r\nrm -rf .')).toThrow(/one line/)
    expect(() => parseTryCommand('npm\u0007run')).toThrow(/control/)
    expect(() => parseTryCommand('x'.repeat(MAX_TRY_COMMAND_LENGTH + 1))).toThrow(/500/)
    expect(parseTryCommand('x'.repeat(MAX_TRY_COMMAND_LENGTH))).toHaveLength(500)
    expect(() => parseTryCommand(42)).toThrow(/text/)
  })

  it('asks before the first run in a project only', () => {
    expect(needsTryWarning({})).toBe(true)
    expect(needsTryWarning({ tryItWarningSeen: false })).toBe(true)
    expect(needsTryWarning({ tryItWarningSeen: true })).toBe(false)
  })
})

describe('an agent suggestion (N9.4)', () => {
  it('keeps one usable line as a suggestion and drops anything else', () => {
    expect(parseSuggestedTryCommand(' npm run preview ')).toBe('npm run preview')
    expect(parseSuggestedTryCommand('npm ci\nnpm run dev')).toBeUndefined()
    expect(parseSuggestedTryCommand('')).toBeUndefined()
    expect(parseSuggestedTryCommand({ command: 'npm test' })).toBeUndefined()
  })

  it('reaches the report from both agent paths through the one parser', () => {
    expect(parseReportExtras({ tryCommand: 'npm run preview' })).toEqual({
      tryCommand: 'npm run preview'
    })
    expect(parseReportExtras({ tryCommand: 'a\nb' })).toEqual({})
  })
})

describe('Try it output (N9.4)', () => {
  it('links localhost, 127.0.0.1 and [::1] addresses', () => {
    const segments = outputSegments(
      'Local: http://localhost:5173/ and http://127.0.0.1:3000/app, also https://[::1]:8443.'
    )
    expect(segments.filter((segment) => segment.url).map((segment) => segment.url)).toEqual([
      'http://localhost:5173/',
      'http://127.0.0.1:3000/app',
      'https://[::1]:8443'
    ])
    expect(segments.map((segment) => segment.text).join('')).toBe(
      'Local: http://localhost:5173/ and http://127.0.0.1:3000/app, also https://[::1]:8443.'
    )
  })

  it('leaves every other link as text', () => {
    for (const line of [
      'See https://example.com/docs',
      'http://localhost.evil.com/',
      'http://192.168.1.4:5173/',
      'ftp://localhost/',
      'xhttp://localhost:3000/',
      'http://user@localhost:3000/'
    ]) {
      expect(outputSegments(line).some((segment) => segment.url)).toBe(false)
    }
    expect(isLocalAddress('http://localhost:3000')).toBe(true)
    expect(isLocalAddress('http://localhost.evil.com')).toBe(false)
    expect(isLocalAddress('javascript:alert(1)')).toBe(false)
  })

  it('strips colour codes and keeps the last 2,000 lines', () => {
    expect(stripTerminalCodes('\x1b[32m  VITE\x1b[0m ready')).toBe('  VITE ready')
    const lines = Array.from({ length: TRY_OUTPUT_LINES + 5 }, (_, index) => String(index))
    trimOutput(lines)
    expect(lines).toHaveLength(TRY_OUTPUT_LINES)
    expect(lines[0]).toBe('5')
  })
})
