import { describe, expect, it } from 'vitest'
import { resolveProjectConventions } from '../../electron/services/project-conventions'

describe('resolveProjectConventions', () => {
  it('gives the trimmed markdown with one closing newline', () => {
    expect(resolveProjectConventions({ agentConventions: '\n# Rules\n\nUse tabs.\n\n' })).toBe(
      '# Rules\n\nUse tabs.\n'
    )
  })

  it('gives nothing for empty, blank or missing conventions', () => {
    expect(resolveProjectConventions({ agentConventions: '' })).toBeNull()
    expect(resolveProjectConventions({ agentConventions: '  \n ' })).toBeNull()
    expect(resolveProjectConventions({})).toBeNull()
  })
})
