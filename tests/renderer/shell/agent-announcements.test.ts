import { describe, expect, it } from 'vitest'
import { agentRunAnnouncements, type RunSnapshot } from '@renderer/shell/agent-announcements'

const run = (status: RunSnapshot['status'], title = 'Fix login'): RunSnapshot => ({
  title,
  projectName: 'Website',
  status
})

describe('agentRunAnnouncements', () => {
  it('says when a run starts, is blocked, resumes and ends', () => {
    const none = new Map<string, RunSnapshot>()
    const active = new Map([['s1', run('active')]])
    const blocked = new Map([['s1', run('blocked')]])
    expect(agentRunAnnouncements(none, active)).toEqual(['Agent started "Fix login" in Website.'])
    expect(agentRunAnnouncements(active, blocked)).toEqual([
      'Agent is blocked on "Fix login" in Website.'
    ])
    expect(agentRunAnnouncements(blocked, active)).toEqual([
      'Agent resumed "Fix login" in Website.'
    ])
    expect(agentRunAnnouncements(active, none)).toEqual([
      'Agent run ended: "Fix login" in Website.'
    ])
  })

  it('says nothing when nothing changed', () => {
    const active = new Map([['s1', run('active')]])
    expect(agentRunAnnouncements(active, new Map(active))).toEqual([])
  })
})
