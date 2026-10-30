import { randomUUID } from 'crypto'
import type { HarnessQuestion, WatchedProject } from '@shared/ostler-api'
import type { HarnessContext } from './context'
import { requireSession, type StoredQuestion } from './types'

/** An agent session blocks itself pending human input. Surfaced as a report alert until answered. */
export function askQuestion(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string,
  question: string
): HarnessQuestion {
  const cleanQuestion = question.trim()
  if (!cleanQuestion) throw new Error('Question text is required')
  let created: StoredQuestion | undefined
  ctx.mutate(project, (state) => {
    const session = requireSession(state, sessionId)
    session.status = 'blocked'
    session.lastUpdate = new Date().toISOString()
    created = {
      id: randomUUID(),
      sessionId,
      sessionTitle: session.title,
      question: cleanQuestion,
      answer: null,
      askedAt: new Date().toISOString(),
      answeredAt: null,
      status: 'pending'
    }
    state.questions.push(created)
  })
  if (!created) throw new Error('Question creation failed')
  ctx.recordEvent(
    project,
    'question_asked',
    { id: sessionId, title: created.sessionTitle },
    cleanQuestion
  )
  return created
}

/** A human answers a pending agent question, unblocking the session. */
export function answerQuestion(
  ctx: HarnessContext,
  project: WatchedProject,
  questionId: string,
  answer: string
): HarnessQuestion {
  const cleanAnswer = answer.trim()
  if (!cleanAnswer) throw new Error('Answer text is required')
  let updated: StoredQuestion | undefined
  ctx.mutate(project, (state) => {
    updated = state.questions.find((q) => q.id === questionId)
    if (!updated) throw new Error(`Question ${questionId} not found`)
    updated.answer = cleanAnswer
    updated.answeredAt = new Date().toISOString()
    updated.status = 'answered'
    const session = state.sessions.find((s) => s.id === updated!.sessionId)
    // A plan waiting on the person (N9.3a) still holds the session.
    if (session && session.status === 'blocked' && session.plan?.status !== 'pending') {
      session.status = 'active'
      session.lastUpdate = new Date().toISOString()
    }
  })
  if (!updated) throw new Error('Question update failed')
  ctx.recordEvent(
    project,
    'question_answered',
    { id: updated.sessionId, title: updated.sessionTitle },
    cleanAnswer
  )
  return updated
}
