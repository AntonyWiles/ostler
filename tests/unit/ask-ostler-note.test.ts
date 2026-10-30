import { describe, expect, it } from 'vitest'
import type { AskSource } from '../../src/shared/ostler-api'
import {
  askNoteDefaultProject,
  askNoteMarkdown,
  askNoteTitle,
  type AskConversationTurn
} from '../../src/shared/ask-ostler-note'
import { boundAskHistory } from '../../src/shared/ask-ostler'
import { BRAND } from '../../src/shared/brand'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const T1 = '33333333-3333-4333-8333-333333333333'

function source(partial: Partial<AskSource> & Pick<AskSource, 'number' | 'type'>): AskSource {
  return { projectId: P1, id: 'x', title: 'X', workItemId: null, ...partial }
}

const turns: AskConversationTurn[] = [
  {
    question: 'Which tiles did we pick for the bathroom?',
    answer: 'Grey tiles [1], ordered by Sam [2].',
    sources: [
      source({ number: 1, type: 'task', id: T1, title: 'Choose [bathroom] tiles' }),
      source({ number: 2, type: 'decision', id: 'd1', title: 'Tiles' })
    ]
  },
  {
    question: 'What about\nthe kitchen?',
    answer: 'The kitchen uses the plan [1].',
    sources: [
      source({
        number: 1,
        type: 'file',
        projectId: P2,
        id: 'docs/plan.md',
        title: 'docs/plan.md',
        path: 'docs/plan.md',
        startLine: 3,
        endLine: 9
      })
    ]
  }
]

const names: Record<string, string> = { [P1]: 'House', [P2]: 'Garden' }

describe('Save as a note (N8.3b)', () => {
  it('writes each question as a heading, each answer, and each answer’s own sources', () => {
    const markdown = askNoteMarkdown({
      turns,
      projectId: P1,
      projectName: (id) => names[id] ?? '',
      today: '2026-10-16'
    })
    const lines = markdown.split('\n')
    expect(lines[0]).toBe('_Written by Ostler AI on 2026-10-16._')
    expect(lines[2]).toBe('Sources from: House, Garden.')
    expect(markdown).toContain('## Which tiles did we pick for the bathroom?')
    expect(markdown).toContain('## What about the kitchen?')
    expect(markdown).toContain('Grey tiles [1], ordered by Sam [2].')
    expect(markdown).toContain(
      `1. [Choose \\[bathroom\\] tiles](${BRAND.urlScheme}://task/${P1}/${T1}) · House`
    )
    expect(markdown).toContain('2. Decision · House · Tiles')
    expect(markdown).toContain('1. File · Garden · docs/plan.md, lines 3 to 9')
    // Each turn's list starts again at 1, matching its answer's [n].
    expect(markdown.indexOf('1. File')).toBeGreaterThan(markdown.indexOf('## What about'))
  })

  it('leaves out the projects line when every source is in the note’s own project', () => {
    const markdown = askNoteMarkdown({
      turns: [turns[0]],
      projectId: P1,
      projectName: (id) => names[id] ?? '',
      today: '2026-10-16'
    })
    expect(markdown).not.toContain('Sources from')
  })

  it('takes the title from the first question, shortened', () => {
    expect(askNoteTitle(turns)).toBe('Which tiles did we pick for the bathroom?')
    const long = askNoteTitle([{ question: 'word '.repeat(40), answer: '', sources: [] }])
    expect(long.length).toBeLessThanOrEqual(80)
    expect(long.endsWith('…')).toBe(true)
  })

  it('defaults to the project most sources came from', () => {
    expect(askNoteDefaultProject(turns)).toBe(P1)
    expect(askNoteDefaultProject([turns[1]])).toBe(P2)
    expect(askNoteDefaultProject([])).toBeNull()
  })
})

describe('boundAskHistory (N8.3b)', () => {
  it('keeps the latest five turns and cuts long answers', () => {
    const earlier = Array.from({ length: 6 }, (_, index) => ({
      question: `Q${index}`,
      answer: index === 5 ? 'y'.repeat(4500) : 'short'
    }))
    const { turns: kept, leftOut } = boundAskHistory(earlier)
    expect(kept.map((turn) => turn.question)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5'])
    expect(kept[4].answer).toHaveLength(4001)
    expect(leftOut).toBe(true)
    expect(boundAskHistory([{ question: 'a', answer: 'b' }]).leftOut).toBe(false)
  })
})
