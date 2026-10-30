import { describe, expect, it } from 'vitest'
import {
  checkWorkEvidence,
  parseTaskReport,
  reportFiles,
  reportHasBlockers,
  reportText
} from '../../electron/services/harness/report-rules'

describe('reportHasBlockers', () => {
  it('treats empty, none and n/a, with or without a trailing note, as no blockers', () => {
    for (const text of [
      '',
      '  ',
      'None',
      'none.',
      'N/A',
      'No blockers',
      'None. Assumption recorded: x'
    ])
      expect(reportHasBlockers(text)).toBe(false)
    expect(reportHasBlockers(undefined)).toBe(false)
  })
  it('treats anything else as a blocker', () => {
    expect(reportHasBlockers('BLOCKED: docs/baseline/visual-audit.md does not exist')).toBe(true)
    expect(reportHasBlockers('Nonexistent prerequisite file')).toBe(true)
  })
})

describe('report caps, shared by external and embedded agents', () => {
  it('caps the file list, each file and the text fields', () => {
    const files = reportFiles([...Array.from({ length: 250 }, (_, i) => ` f${i} `), '', 7])
    expect(files).toHaveLength(200)
    expect(files[0]).toBe('f0')
    expect(reportFiles(['x'.repeat(600)])[0]).toHaveLength(500)
    expect(reportText(` ${'s'.repeat(2500)} `)).toHaveLength(2000)
    expect(reportText(42)).toBe('')
  })
  it('reads a report with usage, and none without a summary', () => {
    const report = parseTaskReport({
      summary: ' Done ',
      filesChanged: ['a.ts'],
      usage: { inputTokens: 10.4, outputTokens: -1, model: 'm' }
    })
    expect(report).toMatchObject({ summary: 'Done', filesChanged: ['a.ts'] })
    expect(report?.usage).toEqual({ inputTokens: 10, model: 'm' })
    expect(parseTaskReport({ filesChanged: ['a.ts'] })).toBeNull()
  })
})

describe('checkWorkEvidence', () => {
  const idle = { committedFilesChanged: 0, hasUncommittedChanges: false }
  it('refuses claimed files, or no report, when the workspace shows no work', () => {
    expect(checkWorkEvidence(idle, { filesChanged: ['a.ts'] })).toContain('no commits')
    expect(checkWorkEvidence(idle, null)).toContain('no commits')
  })
  it('accepts an empty file list, or any report once there is work', () => {
    expect(checkWorkEvidence(idle, { filesChanged: [] })).toBeNull()
    expect(checkWorkEvidence({ ...idle, committedFilesChanged: 1 }, null)).toBeNull()
    expect(
      checkWorkEvidence({ ...idle, hasUncommittedChanges: true }, { filesChanged: ['a.ts'] })
    ).toBeNull()
  })
})
