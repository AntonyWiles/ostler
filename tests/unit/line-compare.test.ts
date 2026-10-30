import { describe, expect, it } from 'vitest'
import { compareLines } from '@shared/planning/line-compare'

const kinds = (older: string, newer: string) =>
  compareLines(older, newer).map((line) => `${line.kind[0]}:${line.text}`)

describe('compareLines (N2.6)', () => {
  it('marks lines only in the older or newer text', () => {
    expect(kinds('a\nb\nc', 'a\nx\nc\nd')).toEqual(['s:a', 'r:b', 'a:x', 's:c', 'a:d'])
    expect(kinds('same', 'same')).toEqual(['s:same'])
    expect(kinds('', 'new')).toEqual(['r:', 'a:new'])
  })

  it('compares tens of thousands of lines quickly', () => {
    const older = Array.from({ length: 30_000 }, (_, n) => `line ${n}`).join('\n')
    const newer = Array.from({ length: 30_000 }, (_, n) => `row ${n}`).join('\n')
    const started = Date.now()
    const lines = compareLines(older, newer)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(lines.filter((line) => line.kind === 'removed')).toHaveLength(30_000)
    expect(lines.filter((line) => line.kind === 'added')).toHaveLength(30_000)
  })
})
