import { describe, expect, it } from 'vitest'
import { buildTaskPrompt } from '../../electron/services/opencode-runner-service'
import {
  generateOstlerAgentInstructionsMd,
  generateOstlerCompleteTaskToolTs
} from '../../electron/services/opencode/ostler-plugin-template'

/** What an embedded run is told about line comments from the last review (N9.2a). */
describe('buildTaskPrompt line comments', () => {
  const task = {
    id: 'task-1',
    title: 'Fix the parser',
    details: 'Make it strict.\n\n[Sent back 1] See the line comments (1 line comment)',
    status: 'pending' as const,
    claimedBy: null,
    priority: 'medium' as const,
    planningWorkItemId: null,
    autoContinue: false,
    hold: false
  }

  it("lists the latest rejection's comments after the details", () => {
    const prompt = buildTaskPrompt(
      {
        ...task,
        rejections: [
          {
            reason: 'See the line comments',
            rejectedAt: '',
            disposition: 'retry',
            sessionId: 's1',
            comments: [
              {
                id: 'c1',
                file: 'src/parse.ts',
                side: 'new',
                firstLine: 4,
                lastLine: 6,
                comment: 'This check is backwards',
                excerpt: '+if (!ok) return'
              }
            ]
          }
        ]
      } as never,
      null
    )
    const details = prompt.indexOf('Make it strict.')
    const comments = prompt.indexOf('Line comments from the last review (1).')
    expect(details).toBeGreaterThan(-1)
    expect(comments).toBeGreaterThan(details)
    expect(prompt).toContain('1. [id: c1] src/parse.ts, lines 4-6')
    expect(prompt).toContain('+if (!ok) return')
    expect(prompt).toContain('Comment: This check is backwards')
  })

  it('says nothing about comments when there are none', () => {
    expect(buildTaskPrompt(task as never, null)).not.toContain('Line comments')
  })

  it('tells the agent in its standing instructions how to treat them', () => {
    const instructions = generateOstlerAgentInstructionsMd('C:/copy', 'main', 'abc')
    expect(instructions).toContain('## Line comments from the last review')
    expect(instructions).toContain('the attempt that was sent back')
    expect(instructions).toContain('never widens the task')
  })

  it('asks for an answer to each comment by id (N9.2b)', () => {
    const instructions = generateOstlerAgentInstructionsMd('C:/copy', 'main', 'abc')
    expect(instructions).toContain('commentAnswers')
    expect(instructions).toContain('No answer')
    const tool = generateOstlerCompleteTaskToolTs(1234, 'secret', 's1', 'p1')
    expect(tool).toContain('commentAnswers: { type: "array"')
    expect(tool).toContain('commentAnswers: args.commentAnswers')
  })
})
