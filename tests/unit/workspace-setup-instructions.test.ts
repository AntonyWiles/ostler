import { describe, expect, it } from 'vitest'
import { generateOstlerAgentInstructionsMd } from '../../electron/services/opencode/ostler-plugin-template'

const SLOT = 'C:\\ostler\\slots\\slot-1'

describe('generateOstlerAgentInstructionsMd dependencies section', () => {
  it('says what Ostler ran, in the section after the workspace', () => {
    const text = generateOstlerAgentInstructionsMd(SLOT, 'nexus/control', 'abc123', {
      status: 'succeeded',
      command: 'npm ci'
    })
    const workspace = text.indexOf('## Your workspace')
    const dependencies = text.indexOf('## Dependencies')
    const committing = text.indexOf('## Committing is not optional')
    expect(workspace).toBeGreaterThan(-1)
    expect(dependencies).toBeGreaterThan(workspace)
    expect(committing).toBeGreaterThan(dependencies)
    expect(text).toContain('Ostler ran `npm ci` in this workspace before you started')
  })

  it('tells the agent it may add dependencies, but not change the scripts to hide a broken setup', () => {
    const text = generateOstlerAgentInstructionsMd(SLOT, 'nexus/control', 'abc123', {
      status: 'succeeded',
      command: 'npm ci'
    })
    expect(text).toContain("add it with the project's package")
    expect(text).toContain('commit the lockfile')
    expect(text).toContain(
      "Never change the project's scripts or config to work around a broken environment"
    )
    expect(text).toContain('under `blockers`')
  })

  it('states the no-setup and off cases', () => {
    const none = generateOstlerAgentInstructionsMd(SLOT, 'nexus/control', 'abc123')
    expect(none).toContain('No setup ran for this workspace.')
    const off = generateOstlerAgentInstructionsMd(SLOT, 'nexus/control', 'abc123', {
      status: 'skipped',
      skipReason: 'off'
    })
    expect(off).toContain('Setup is off for this project')
  })
})
