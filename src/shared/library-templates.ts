import { formatDate } from './format'
import { t } from './i18n'

/**
 * Starting text for new Library briefs, guides and meeting notes.
 */

function template(sections: string[]): string {
  return sections.map((section) => `## ${section}\n\n`).join('\n')
}

const BRIEF_SECTIONS = [
  'purpose',
  'audience',
  'goals',
  'scope',
  'outOfScope',
  'constraints',
  'lookAndFeel',
  'deliverables',
  'openQuestions'
] as const

const GUIDE_SECTIONS = ['purpose', 'appliesTo', 'rules', 'do', 'dont', 'examples'] as const

/** A new brief's headings, in the interface language. */
export function libraryBriefTemplate(): string {
  return template(BRIEF_SECTIONS.map((id) => t(`library:templates.brief.${id}`)))
}

/** A new guide's headings, in the interface language. */
export function libraryGuideTemplate(): string {
  return template(GUIDE_SECTIONS.map((id) => t(`library:templates.guide.${id}`)))
}

const MEETING_SECTIONS = ['attendees', 'agenda', 'notes', 'decisions', 'actions'] as const

/**
 * A new meeting note's headings, in the interface language, with today's
 * date filled in under the first (N4.1b).
 */
export function libraryMeetingTemplate(now: Date = new Date()): string {
  const date = `## ${t('library:templates.meeting.date')}\n\n${formatDate(now, { dateStyle: 'long' })}\n\n`
  return `${date}\n${template(MEETING_SECTIONS.map((id) => t(`library:templates.meeting.${id}`)))}`
}
