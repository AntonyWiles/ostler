import { describe, expect, it } from 'vitest'
import { releaseNotes } from '../../scripts/release-notes.cjs'

const CHANGELOG = `# Changelog

Every notable change.

## [Unreleased]

### Added

- Coming soon.

## [1.1.0] - 2026-11-02

### Fixed

- Boards scroll again.

## [1.0.0] - 2026-10-20

### Added

- The first public release.

## [0.9.0] - 2026-09-01

[1.0.0]: https://github.com/AntonyWiles/ostler/releases/tag/v1.0.0
`

describe('release-notes.cjs', () => {
  it("prints the found version's section, without the next one or link definitions", () => {
    expect(releaseNotes(CHANGELOG, '1.0.0')).toBe('### Added\n\n- The first public release.')
    expect(releaseNotes(CHANGELOG, 'v1.1.0')).toBe('### Fixed\n\n- Boards scroll again.')
  })

  it('fails for a missing version, and says to move the Unreleased notes', () => {
    expect(() => releaseNotes(CHANGELOG, '2.0.0')).toThrow(/no notes for 2\.0\.0.*Unreleased/)
    // A section with nothing in it is no better than none.
    expect(() => releaseNotes(CHANGELOG, '0.9.0')).toThrow(/no notes for 0\.9\.0/)
    expect(() => releaseNotes(CHANGELOG, '')).toThrow(/Name a version/)
  })

  it('prints Unreleased when asked, for a dry run', () => {
    expect(releaseNotes(CHANGELOG, 'Unreleased')).toBe('### Added\n\n- Coming soon.')
    expect(() => releaseNotes('## [Unreleased]\n\n## [1.0.0]\n\n- x\n', 'Unreleased')).toThrow(
      /nothing under \[Unreleased\]/
    )
  })
})
