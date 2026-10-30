import type {
  Briefing,
  BriefingByActor,
  BriefingList,
  BriefingWriteUp,
  OstlerConfig
} from '@shared/ostler-api'
import { currentLanguage, t } from '@shared/i18n'
import { requireAi } from './ai-access'

/**
 * Write it up (N1.6, decision N14): Ostler AI turns a briefing into one short
 * paragraph. It is sent titles and counts only: never a description, a
 * comment's text, an agent's question, or a person's or rule's name (who did
 * something is sent as the kind of actor). The card's facts stay below it.
 */

export const BRIEFING_AI_SYSTEM_PROMPT = [
  'You write a short catch-up for one person returning to their project manager.',
  'You are given facts as JSON: per project, counts and a few task titles for what was finished, added, commented on, overdue, reminded, and agent runs.',
  'Write one paragraph of at most 90 words, plain text, no lists, no headings, no Markdown.',
  'Use only the facts given. Do not invent tasks, people, dates or reasons. Do not give advice or say what matters most.',
  'Mention the projects with the most activity first. Round nothing: say the counts as given.'
].join('\n')

interface ListFacts {
  count: number
  titles: string[]
}

const listFacts = (list: BriefingList): ListFacts => ({
  count: list.count,
  titles: list.tasks.map((task) => task.title)
})

const actorFacts = (groups: BriefingByActor[]) =>
  groups.map((group) => ({ by: group.actor, ...listFacts(group) }))

/** What the model is sent: titles and counts, nothing else. */
export function briefingAiFacts(briefing: Briefing) {
  return {
    hoursAway: Math.round((briefing.until - briefing.since) / (60 * 60 * 1000)),
    projects: briefing.projects.map((project) => ({
      project: project.projectName,
      finished: actorFacts(project.finished),
      added: actorFacts(project.added),
      comments: listFacts(project.comments),
      dueDatesPassed: listFacts(project.overdue),
      remindersFired: listFacts(project.reminders),
      agentRunsFinished: listFacts(project.runsFinished),
      agentRunsWaitingForReview: listFacts(project.runsInReview),
      agentQuestionsWaiting: project.questions
    }))
  }
}

export function briefingAiUserPrompt(briefing: Briefing, language: string): string {
  return [
    `Write in the language with code "${language}".`,
    'Facts:',
    JSON.stringify(briefingAiFacts(briefing))
  ].join('\n')
}

/** Asks Ostler AI through the one gate, `requireAi`; refuses when AI is not set up. */
export async function writeBriefingUp(
  config: OstlerConfig,
  briefing: Briefing,
  now: () => number = Date.now
): Promise<BriefingWriteUp> {
  const { provider, model } = requireAi(config, null)
  let text = ''
  for await (const chunk of provider.chat(
    [
      { role: 'system', content: BRIEFING_AI_SYSTEM_PROMPT },
      { role: 'user', content: briefingAiUserPrompt(briefing, currentLanguage()) }
    ],
    { model, maxTokens: Math.max(config.ai.maxTokens || 0, 1024), temperature: 0.2, stream: true }
  ))
    text += chunk
  if (!text.trim()) throw new Error(t('views:briefing.writeUpFailed'))
  return { text: text.trim().slice(0, 2000), model, at: now() }
}
