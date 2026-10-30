import { MAX_PROJECT_CONVENTIONS_LENGTH, type ProjectLesson } from './ostler-api/project-types'
import { Refusal } from './refusal'

/**
 * Lessons (N9.6a, N64): short rules the person saved with "Remember this for
 * next time" after sending agent work back, read by every later agent on the
 * project with its conventions. These are the one set of rules for them,
 * whichever surface changes them: Project settings, the Send back offer and
 * the automation API all build the new list here and save it through
 * `configStore.updateProject`, which checks it with `parseProjectLessons`.
 */

/** The longest lesson. */
export const MAX_LESSON_LENGTH = 500
/** The most lessons a project keeps. */
export const MAX_PROJECT_LESSONS = 100
/** The longest task title a lesson's source keeps. */
export const MAX_LESSON_SOURCE_TITLE_LENGTH = 200

/** A lesson's text, trimmed and checked: never empty, at most 500 characters. */
export function parseLessonText(value: unknown): string {
  if (typeof value !== 'string') throw new Refusal('A lesson is text')
  const text = value.trim()
  if (!text) throw new Refusal('Write the lesson first')
  if (text.length > MAX_LESSON_LENGTH) {
    throw new Refusal(`A lesson can be at most ${MAX_LESSON_LENGTH} characters`)
  }
  return text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSource(value: unknown): ProjectLesson['source'] {
  if (value === null || value === undefined) return null
  if (
    !isRecord(value) ||
    typeof value.sessionId !== 'string' ||
    typeof value.taskTitle !== 'string'
  ) {
    throw new Refusal("A lesson's source is a session and a task title")
  }
  return {
    sessionId: value.sessionId,
    taskTitle: value.taskTitle.trim().slice(0, MAX_LESSON_SOURCE_TITLE_LENGTH)
  }
}

/** The whole list of a project's lessons, checked: the one validation every writer goes through. */
export function parseProjectLessons(value: unknown): ProjectLesson[] {
  if (!Array.isArray(value)) throw new Refusal('Lessons must be a list')
  if (value.length > MAX_PROJECT_LESSONS) {
    throw new Refusal(`A project can keep at most ${MAX_PROJECT_LESSONS} lessons`)
  }
  const lessons = value.map((entry): ProjectLesson => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim()) {
      throw new Refusal('Each lesson has an id')
    }
    if (typeof entry.enabled !== 'boolean') throw new Refusal('A lesson is on or off')
    if (typeof entry.addedAt !== 'number' || !Number.isFinite(entry.addedAt)) {
      throw new Refusal('A lesson has the time it was added')
    }
    return {
      id: entry.id,
      text: parseLessonText(entry.text),
      enabled: entry.enabled,
      addedAt: entry.addedAt,
      source: parseSource(entry.source)
    }
  })
  if (new Set(lessons.map((lesson) => lesson.id)).size !== lessons.length) {
    throw new Refusal('Lessons list a lesson twice')
  }
  return lessons
}

/** A project's lessons as saved, or none. */
export function projectLessons(project: { agentLessons?: ProjectLesson[] }): ProjectLesson[] {
  return Array.isArray(project.agentLessons) ? project.agentLessons : []
}

/** The list with a new lesson at its end, on. Refuses past the limit. */
export function addLesson(
  lessons: readonly ProjectLesson[],
  input: { text: unknown; source?: ProjectLesson['source'] },
  made: { id: string; now: number }
): ProjectLesson[] {
  if (lessons.length >= MAX_PROJECT_LESSONS) {
    throw new Refusal(
      `A project can keep at most ${MAX_PROJECT_LESSONS} lessons: delete one or move it into the conventions first`
    )
  }
  return [
    ...lessons,
    {
      id: made.id,
      text: parseLessonText(input.text),
      enabled: true,
      addedAt: made.now,
      source: parseSource(input.source)
    }
  ]
}

function findLesson(lessons: readonly ProjectLesson[], id: string): ProjectLesson {
  const lesson = lessons.find((entry) => entry.id === id)
  if (!lesson) throw new Refusal(`Lesson with ID ${id} not found`)
  return lesson
}

/** The list with one lesson's text or switch changed. */
export function editLesson(
  lessons: readonly ProjectLesson[],
  id: string,
  changes: { text?: unknown; enabled?: unknown }
): ProjectLesson[] {
  findLesson(lessons, id)
  if (changes.enabled !== undefined && typeof changes.enabled !== 'boolean') {
    throw new Refusal('A lesson is on or off: send enabled as true or false')
  }
  const text = changes.text === undefined ? undefined : parseLessonText(changes.text)
  return lessons.map((lesson) =>
    lesson.id === id
      ? {
          ...lesson,
          ...(text !== undefined ? { text } : {}),
          ...(changes.enabled !== undefined ? { enabled: changes.enabled as boolean } : {})
        }
      : lesson
  )
}

/** The list without one lesson. */
export function removeLesson(lessons: readonly ProjectLesson[], id: string): ProjectLesson[] {
  findLesson(lessons, id)
  return lessons.filter((lesson) => lesson.id !== id)
}

/**
 * Move into conventions: the lesson's text appended to the conventions as a
 * list item, and the lesson removed. Refuses when the conventions would be
 * too long.
 */
export function moveLessonIntoConventions(
  project: { agentConventions?: string; agentLessons?: ProjectLesson[] },
  id: string
): { agentConventions: string; agentLessons: ProjectLesson[] } {
  const lessons = projectLessons(project)
  const lesson = findLesson(lessons, id)
  const current = (project.agentConventions ?? '').replace(/\s+$/, '')
  const line = `- ${oneLine(lesson.text)}`
  const agentConventions = current ? `${current}\n${line}\n` : `${line}\n`
  if (agentConventions.length > MAX_PROJECT_CONVENTIONS_LENGTH) {
    throw new Refusal(
      `Project conventions can be at most ${MAX_PROJECT_CONVENTIONS_LENGTH} characters`
    )
  }
  return { agentConventions, agentLessons: removeLesson(lessons, id) }
}

/** A lesson's text on one line, as the agents' list shows it. */
export function oneLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, ' ').trim()
}

/** The local date `YYYY-MM-DD` a lesson was added, as agents read it. */
export function lessonDate(addedAt: number): string {
  const date = new Date(addedAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
