import { describe, expect, it } from 'vitest'
import {
  parsePictureRequests,
  parseReportExtras,
  parseWalkthrough,
  relativeReportPath
} from '../../src/shared/agent-report-extras'

describe('report paths', () => {
  it('keeps relative paths and refuses absolute ones and climbs out', () => {
    expect(relativeReportPath('shots\\home.png')).toBe('shots/home.png')
    expect(relativeReportPath('./a/./b.png')).toBe('a/b.png')
    expect(relativeReportPath('../outside.png')).toBeNull()
    expect(relativeReportPath('a/../../b.png')).toBeNull()
    expect(relativeReportPath('/etc/passwd')).toBeNull()
    expect(relativeReportPath('C:\\Windows\\x.png')).toBeNull()
    expect(relativeReportPath('')).toBeNull()
    expect(relativeReportPath(42)).toBeNull()
  })
})

describe('picture requests', () => {
  it('reads strings and objects and cuts captions to 200 characters', () => {
    const requests = parsePictureRequests([
      'a.png',
      { path: 'b.png', caption: `line one\nline two ${'x'.repeat(300)}` },
      { caption: 'no path' },
      7
    ])
    expect(requests).toHaveLength(2)
    expect(requests[0]).toEqual({ path: 'a.png' })
    expect(requests[1].caption).toHaveLength(200)
    expect(requests[1].caption).not.toContain('\n')
    expect(parsePictureRequests('a.png')).toEqual([])
  })
})

describe('walkthrough', () => {
  it('keeps at most 30 stops and cuts notes to 1,000 characters', () => {
    const stops = parseWalkthrough(
      Array.from({ length: 40 }, (_, i) => ({
        path: `src/f${i}.ts`,
        startLine: i + 1,
        endLine: i + 3,
        note: 'n'.repeat(1500)
      }))
    )
    expect(stops).toHaveLength(30)
    expect(stops[0].note).toHaveLength(1000)
  })

  it('drops stops with a bad path, line or note, and orders lines', () => {
    const stops = parseWalkthrough([
      { path: '../x.ts', startLine: 1, endLine: 2, note: 'climbs out' },
      { path: '/abs.ts', startLine: 1, endLine: 2, note: 'absolute' },
      { path: 'a.ts', startLine: 0, endLine: 2, note: 'line zero' },
      { path: 'a.ts', startLine: 2, endLine: 2, note: '' },
      { path: 'b.ts', startLine: 9, endLine: 4, note: 'backwards' },
      { path: 'c.ts', startLine: '5', note: 'one line\nkept on two' }
    ])
    expect(stops).toEqual([
      { path: 'b.ts', startLine: 4, endLine: 9, note: 'backwards' },
      { path: 'c.ts', startLine: 5, endLine: 5, note: 'one line\nkept on two' }
    ])
  })

  it('leaves empty extras out of the report', () => {
    expect(parseReportExtras({ pictures: [], walkthrough: 'no' })).toEqual({})
  })
})
