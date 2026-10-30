import { describe, expect, it } from 'vitest'
import { buildProjectChatAddendum } from '../../src/shared/ostler-ai-prompts'

const planning = { goals: [], milestones: [], workItems: [] }

describe('project chat: project files', () => {
  it('lists the files, attaches the named ones and says how to ask for more', () => {
    const prompt = buildProjectChatAddendum({
      projectName: 'Traffic',
      planning,
      files: {
        list: ['README.md', 'marketing/roles/writer.md'],
        totalFiles: 2,
        truncated: false,
        read: '### README.md\nHello'
      }
    })
    expect(prompt).toContain('You can read this project')
    expect(prompt).toContain('- marketing/roles/writer.md')
    expect(prompt).toContain('### README.md')
    expect(prompt).toContain('ostler-read')
    expect(prompt).toContain('never change them')
  })

  it('leaves the section out for a project without a folder', () => {
    const prompt = buildProjectChatAddendum({ projectName: 'Traffic', planning })
    expect(prompt).not.toContain('## Project files')
  })
})

describe('project chat: the words it uses', () => {
  it('calls work items tasks when it writes to the owner, and keeps the block type', () => {
    const prompt = buildProjectChatAddendum({ projectName: 'Traffic', planning })
    expect(prompt).toContain('call work items "tasks"')
    expect(prompt).toContain('{"type":"work_item"')
  })
})
