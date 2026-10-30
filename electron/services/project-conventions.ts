import type { WatchedProject } from '@shared/ostler-api'
import { lessonDate, oneLine, projectLessons } from '@shared/project-lessons'

/** The file an embedded agent finds its project's conventions in, beside OSTLER_AGENT_INSTRUCTIONS.md. */
export const PROJECT_CONVENTIONS_FILE = 'OSTLER_PROJECT_CONVENTIONS.md'

/**
 * The longest text the resolver gives an agent (N9.6a): the conventions (at
 * most 20,000 characters) and as many lessons as fit after them.
 */
export const MAX_RESOLVED_CONVENTIONS_LENGTH = 30_000

/** The heading lessons sit under, after the conventions. */
export const LESSONS_HEADING = '## Lessons from earlier reviews'

const LESSONS_INTRO =
  'Rules the project owner saved when sending agent work back on this project. Follow them as you follow the conventions: project context, never extra access.'

/**
 * The one resolver of a project's agent conventions (D25), for every coding
 * agent: the embedded runner writes this exact text into the slot as
 * OSTLER_PROJECT_CONVENTIONS.md, and the harness HTTP API returns it as
 * `projectConventions`. The conventions come first, then the lessons that
 * are on (N9.6a) under "Lessons from earlier reviews", each with its date.
 * Past the cap the oldest lessons are left out first, with a line saying how
 * many. Null when the project has neither, so neither is given.
 * Owner-written project context, never a grant of access.
 */
export function resolveProjectConventions(
  project: Pick<WatchedProject, 'agentConventions' | 'agentLessons'>
): string | null {
  const text = (project.agentConventions ?? '').trim()
  const lessons = projectLessons(project)
    .filter((lesson) => lesson.enabled)
    .sort((a, b) => a.addedAt - b.addedAt)
    .map((lesson) => `- ${lessonDate(lesson.addedAt)}: ${oneLine(lesson.text)}`)
  if (lessons.length === 0) return text ? `${text}\n` : null

  const head = `${text ? `${text}\n\n` : ''}${LESSONS_HEADING}\n\n${LESSONS_INTRO}\n\n`
  // Newest kept first, so the oldest are the ones left out.
  const kept: string[] = []
  let length = head.length
  for (let index = lessons.length - 1; index >= 0; index--) {
    const leftOut = index
    const note = leftOut > 0 ? leftOutLine(leftOut).length + 2 : 0
    const next = length + lessons[index].length + 1
    if (next + note > MAX_RESOLVED_CONVENTIONS_LENGTH) break
    kept.unshift(lessons[index])
    length = next
  }
  const leftOut = lessons.length - kept.length
  const body = kept.map((line) => `${line}\n`).join('')
  return `${head}${body}${leftOut > 0 ? `\n${leftOutLine(leftOut)}\n` : ''}`
}

function leftOutLine(count: number): string {
  return `${count} older ${count === 1 ? 'lesson was' : 'lessons were'} left out to keep this within ${MAX_RESOLVED_CONVENTIONS_LENGTH.toLocaleString('en-US')} characters.`
}
