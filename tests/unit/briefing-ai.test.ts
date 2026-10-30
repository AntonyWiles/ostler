import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type Briefing } from '../../src/shared/ostler-api'

const sent: { role: string; content: unknown }[][] = []
const requireAi = vi.fn(() => ({
  providerId: 'openai',
  model: 'test-model',
  provider: {
    async *chat(messages: { role: string; content: unknown }[]) {
      sent.push(messages)
      yield 'Agents finished '
      yield 'seven tasks.'
    },
    testConnection: async () => ({ ok: true })
  }
}))
vi.mock('../../electron/services/ai-access', () => ({ requireAi }))

const { writeBriefingUp } = await import('../../electron/services/briefing-ai')

const briefing: Briefing = {
  since: 0,
  until: 14 * 60 * 60 * 1000,
  projects: [
    {
      projectId: 'p1',
      projectName: 'Website',
      projectColor: '#3b82f6',
      finished: [
        {
          actor: 'person',
          name: 'Jordan Secret',
          count: 2,
          tasks: [{ id: 't1', title: 'Fix footer' }]
        }
      ],
      added: [
        { actor: 'rule', name: 'Private rule', count: 1, tasks: [{ id: 't2', title: 'Pay' }] }
      ],
      comments: { count: 3, tasks: [{ id: 't1', title: 'Fix footer' }] },
      overdue: { count: 0, tasks: [] },
      reminders: { count: 0, tasks: [] },
      runsFinished: { count: 1, tasks: [{ id: null, title: 'Agent run' }] },
      runsInReview: { count: 0, tasks: [] },
      questions: 1
    }
  ]
}

describe('Write it up (N1.6)', () => {
  it('asks through requireAi and sends only titles and counts', async () => {
    const config = { ...DEFAULT_CONFIG, ai: { ...DEFAULT_CONFIG.ai, maxTokens: 0 } }
    const result = await writeBriefingUp(config, briefing, () => 42)
    expect(result).toEqual({ text: 'Agents finished seven tasks.', model: 'test-model', at: 42 })
    expect(requireAi).toHaveBeenCalledWith(config, null)

    const user = JSON.parse(String(sent[0][1].content).split('\n').slice(2).join('\n'))
    expect(user).toEqual({
      hoursAway: 14,
      projects: [
        {
          project: 'Website',
          finished: [{ by: 'person', count: 2, titles: ['Fix footer'] }],
          added: [{ by: 'rule', count: 1, titles: ['Pay'] }],
          comments: { count: 3, titles: ['Fix footer'] },
          dueDatesPassed: { count: 0, titles: [] },
          remindersFired: { count: 0, titles: [] },
          agentRunsFinished: { count: 1, titles: ['Agent run'] },
          agentRunsWaitingForReview: { count: 0, titles: [] },
          agentQuestionsWaiting: 1
        }
      ]
    })
    const everything = JSON.stringify(sent[0])
    expect(everything).not.toContain('Jordan Secret')
    expect(everything).not.toContain('Private rule')
    expect(everything).not.toContain('t1')
  })
})
