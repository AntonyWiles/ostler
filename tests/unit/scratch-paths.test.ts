import { describe, it, expect } from 'vitest'
import {
  SCRATCH_CONFIG,
  assertDeletable,
  assertScratchName,
  scratchDataDir,
  scratchProjectDir
} from '../../scripts/scratch-paths.cjs'

describe('scratch-paths', () => {
  it('accepts lower-case letters, digits and hyphens', () => {
    expect(assertScratchName('p0-2')).toBe('p0-2')
  })

  it.each(['', 'P0-2', 'a b', '../x', 'a/b', 'a\\b', 'x.y', 'C:'])('rejects %j', (name) => {
    expect(() => assertScratchName(name)).toThrow(/\[a-z0-9-\]\+/)
  })

  it('builds scratch folders under C:\\temp\\ostler-roadmap', () => {
    expect(scratchDataDir('p0-2')).toBe('C:\\temp\\ostler-roadmap\\p0-2')
    expect(scratchProjectDir('demo')).toBe('C:\\temp\\ostler-roadmap\\projects\\demo')
  })

  it('allows deleting a folder inside the scratch root', () => {
    expect(assertDeletable('C:\\temp\\ostler-roadmap\\p0-2')).toBe('C:\\temp\\ostler-roadmap\\p0-2')
  })

  it.each([
    'C:\\temp\\ostler-roadmap',
    'C:\\temp\\ostler-roadmap\\projects',
    'C:\\temp\\ostler-roadmap\\..\\other',
    'C:\\temp\\ostler-roadmap-other\\x',
    'C:\\Users\\someone\\AppData\\Roaming\\ostler',
    'D:\\temp\\ostler-roadmap\\p0-2'
  ])('refuses to delete %s', (target) => {
    expect(() => assertDeletable(target)).toThrow(/Refusing to delete/)
  })

  it('moves a scratch instance off the default ports', () => {
    expect(SCRATCH_CONFIG).toEqual({
      harness: { enabled: false, port: 18934 },
      automationApi: { enabled: false, port: 18935 }
    })
  })
})
