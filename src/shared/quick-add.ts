import type { PlanningPriority } from './ostler-api'
import { isIsoDate, isoWeekday, shiftIsoDate } from './dates'
import { taskPriorityLabel } from './task-labels'

/**
 * Quick add (P5.6): one line becomes a task. Pure, so the renderer can
 * preview what it found as chips while the person types, and tests can pin
 * every rule.
 *
 * - `#label`, `@person`, `+Project`
 * - `!low`, `!med`, `!high`, `!crit` (and `!medium`, `!critical`)
 * - dates: today, tomorrow, weekday names, "next week", "in N days" (or
 *   weeks), ISO dates and numeric dates in the locale's day and month order,
 *   optionally after "on", "by" or "due"
 *
 * Words are matched whole, so "today's" stays in the title. Only the first
 * of each kind is used; a second date or priority stays in the title. A
 * person or project that matches nobody also stays in the title, and is
 * reported in `unknown` so the preview can say so. A label that is not used
 * yet is still a label: labels are free text.
 */

export interface QuickAddPerson {
  id: string
  name: string
  isMe?: boolean
}

export interface QuickAddProject {
  id: string
  name: string
}

export interface QuickAddContext {
  /** Today where the user is, `YYYY-MM-DD`. */
  today: string
  /** A BCP 47 locale ("en-NZ", "en-US"); decides whether 3/4 is 3 April or March 4. */
  locale: string
  people: QuickAddPerson[]
  /** Labels already in use, so `#Admin` reuses "admin" as it is spelled. */
  labels: string[]
  projects: QuickAddProject[]
  /** Token start offsets the person removed from the preview: left as title text. */
  ignore?: number[]
}

export type QuickAddTokenKind = 'label' | 'person' | 'priority' | 'project' | 'date'

export interface QuickAddToken {
  kind: QuickAddTokenKind
  /** The text as typed, and where it is in the line. */
  text: string
  start: number
  end: number
  /** The label, person id, priority, project id or `YYYY-MM-DD`. */
  value: string
  /** What the chip says: "admin", "Ada Lovelace", "High", "Website", the date. */
  display: string
  /** A label not used in this project yet. */
  isNew?: boolean
}

export interface QuickAddResult {
  title: string
  labels: string[]
  assigneeId: string | null
  priority: PlanningPriority | null
  projectId: string | null
  dueDate: string | null
  tokens: QuickAddToken[]
  /** `@name` and `+Project` words that matched nobody; they stay in the title. */
  unknown: { kind: 'person' | 'project'; text: string }[]
}

const PRIORITIES: Record<string, PlanningPriority> = {
  low: 'low',
  med: 'medium',
  medium: 'medium',
  high: 'high',
  crit: 'critical',
  critical: 'critical'
}

/** "sat" and "sun" are words too often to be dates. */
const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
}

interface Word {
  text: string
  lower: string
  start: number
  end: number
}

function words(text: string): Word[] {
  const found: Word[] = []
  const pattern = /\S+/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    found.push({
      text: match[0],
      lower: match[0].toLowerCase(),
      start: match.index,
      end: match.index + match[0].length
    })
  }
  return found
}

/** Letters and digits only, lower case: how names are compared. */
function squash(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** Whether the locale writes the day before the month (en-NZ) or after it (en-US). */
export function dayBeforeMonth(locale: string): boolean {
  try {
    const order = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric'
    })
      .formatToParts(new Date(2000, 11, 31))
      .filter((part) => part.type === 'day' || part.type === 'month')
      .map((part) => part.type)
    return order[0] === 'day'
  } catch {
    return true
  }
}

function iso(y: number, m: number, d: number): string | null {
  const value = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return isIsoDate(value) ? value : null
}

/** A numeric date ("3/4", "3/4/27", "03.04.2027") in the locale's order. */
function numericDate(word: string, context: QuickAddContext): string | null {
  const match = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/.exec(word)
  if (!match) return null
  const [first, second] = [Number(match[1]), Number(match[2])]
  const [day, month] = dayBeforeMonth(context.locale) ? [first, second] : [second, first]
  if (match[3]) {
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])
    return iso(year, month, day)
  }
  // No year: the next time that day comes round, today included.
  const thisYear = Number(context.today.slice(0, 4))
  const candidate = iso(thisYear, month, day)
  if (candidate && candidate >= context.today) return candidate
  return iso(thisYear + 1, month, day) ?? candidate
}

function weekdayFrom(today: string, weekday: number): string {
  const offset = (weekday - isoWeekday(today) + 7) % 7
  return shiftIsoDate(today, offset)
}

/** A date starting at word `index`: the date and how many words it used. */
function dateAt(
  list: Word[],
  index: number,
  context: QuickAddContext
): { date: string; length: number } | null {
  const word = list[index].lower.replace(/[,;]$/, '')
  const next = list[index + 1]?.lower.replace(/[,;]$/, '')
  if (word === 'today' || word === 'tod') return { date: context.today, length: 1 }
  if (word === 'tomorrow' || word === 'tmr' || word === 'tmrw')
    return { date: shiftIsoDate(context.today, 1), length: 1 }
  if (word in WEEKDAYS) return { date: weekdayFrom(context.today, WEEKDAYS[word]), length: 1 }
  if (word === 'next' && next === 'week') {
    // Monday of next week.
    const monday = shiftIsoDate(context.today, -((isoWeekday(context.today) + 6) % 7))
    return { date: shiftIsoDate(monday, 7), length: 2 }
  }
  if (word === 'next' && next !== undefined && next in WEEKDAYS) {
    // A weekday in the week after this one.
    const monday = shiftIsoDate(context.today, -((isoWeekday(context.today) + 6) % 7))
    const offset = (WEEKDAYS[next] + 6) % 7
    return { date: shiftIsoDate(monday, 7 + offset), length: 2 }
  }
  if (word === 'in' && next !== undefined) {
    const unit = list[index + 2]?.lower.replace(/[,;]$/, '')
    const count = /^\d{1,3}$/.test(next) ? Number(next) : NUMBER_WORDS[next]
    if (count !== undefined && unit !== undefined) {
      if (unit === 'day' || unit === 'days')
        return { date: shiftIsoDate(context.today, count), length: 3 }
      if (unit === 'week' || unit === 'weeks')
        return { date: shiftIsoDate(context.today, count * 7), length: 3 }
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(word) && isIsoDate(word)) return { date: word, length: 1 }
  const numeric = numericDate(word, context)
  if (numeric) return { date: numeric, length: 1 }
  return null
}

function formatDate(value: string, locale: string): string {
  const [y, m, d] = value.split('-').map(Number)
  try {
    return new Date(y, m - 1, d).toLocaleDateString(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    })
  } catch {
    return value
  }
}

/**
 * The one rule for finding a person by a name as someone wrote it: "me", the
 * full name, the first name, then a unique start of the name. Null when it is
 * nobody or more than one person.
 */
export function findPerson(name: string, people: QuickAddPerson[]): QuickAddPerson | null {
  const wanted = squash(name)
  if (!wanted) return null
  if (wanted === 'me') return people.find((person) => person.isMe) ?? null
  const exact = people.filter((person) => squash(person.name) === wanted)
  if (exact.length === 1) return exact[0]
  const first = people.filter((person) => squash(person.name.split(/\s+/)[0] ?? '') === wanted)
  if (first.length === 1) return first[0]
  const prefix = people.filter((person) => squash(person.name).startsWith(wanted))
  return prefix.length === 1 ? prefix[0] : null
}

function findProject(name: string, projects: QuickAddProject[]): QuickAddProject | null {
  const wanted = squash(name)
  if (!wanted) return null
  const exact = projects.filter((project) => squash(project.name) === wanted)
  if (exact.length === 1) return exact[0]
  const prefix = projects.filter((project) => squash(project.name).startsWith(wanted))
  return prefix.length === 1 ? prefix[0] : null
}

/**
 * Who a captured task is for, the one rule for capture: the @person the words
 * name, else Me, so it shows in your Upcoming on Home, which lists only tasks
 * assigned to you. Null when nobody is named and no one is Me. Quick add and
 * Make a task from a line both ask this.
 */
export function captureAssigneeId(named: string | null, meId: string | null): string | null {
  return named ?? meId
}

/** Me among the people quick add reads, or null. */
export function quickAddMeId(people: readonly QuickAddPerson[]): string | null {
  return people.find((person) => person.isMe)?.id ?? null
}

export function parseQuickAdd(text: string, context: QuickAddContext): QuickAddResult {
  const list = words(text)
  const ignore = new Set(context.ignore ?? [])
  const tokens: QuickAddToken[] = []
  const unknown: QuickAddResult['unknown'] = []
  const used = new Set<number>()
  const labels: string[] = []
  let assigneeId: string | null = null
  let priority: PlanningPriority | null = null
  let projectId: string | null = null
  let dueDate: string | null = null

  const take = (
    from: number,
    length: number,
    token: Omit<QuickAddToken, 'text' | 'start' | 'end'>
  ) => {
    const start = list[from].start
    const end = list[from + length - 1].end
    for (let index = from; index < from + length; index += 1) used.add(index)
    tokens.push({ ...token, text: text.slice(start, end), start, end })
  }

  for (let index = 0; index < list.length; index += 1) {
    const word = list[index]
    if (ignore.has(word.start)) continue
    const sigil = word.text[0]
    const rest = word.text.slice(1).replace(/[,;.]$/, '')

    if (sigil === '#' && rest && !rest.includes('#')) {
      const existing = context.labels.find((label) => label.toLowerCase() === rest.toLowerCase())
      const label = existing ?? rest
      if (!labels.some((candidate) => candidate.toLowerCase() === label.toLowerCase())) {
        labels.push(label)
        take(index, 1, { kind: 'label', value: label, display: label, isNew: !existing })
      }
      continue
    }
    if (sigil === '@' && rest) {
      const person: QuickAddPerson | null =
        assigneeId === null ? findPerson(rest, context.people) : null
      if (person) {
        assigneeId = person.id
        take(index, 1, { kind: 'person', value: person.id, display: person.name })
      } else if (assigneeId === null) unknown.push({ kind: 'person', text: word.text })
      continue
    }
    if (sigil === '+' && rest) {
      const project: QuickAddProject | null =
        projectId === null ? findProject(rest, context.projects) : null
      if (project) {
        projectId = project.id
        take(index, 1, { kind: 'project', value: project.id, display: project.name })
      } else if (projectId === null) unknown.push({ kind: 'project', text: word.text })
      continue
    }
    if (sigil === '!' && rest.toLowerCase() in PRIORITIES) {
      if (priority === null) {
        priority = PRIORITIES[rest.toLowerCase()]
        take(index, 1, { kind: 'priority', value: priority, display: taskPriorityLabel(priority) })
      }
      continue
    }
    if (dueDate === null) {
      // "on Friday", "by 3/4", "due tomorrow": the little word goes too.
      const lead = ['on', 'by', 'due'].includes(word.lower) && index + 1 < list.length ? 1 : 0
      if (lead && ignore.has(list[index + 1].start)) continue
      const found = dateAt(list, index + lead, context)
      if (found) {
        dueDate = found.date
        take(index, lead + found.length, {
          kind: 'date',
          value: found.date,
          display: formatDate(found.date, context.locale)
        })
        index += lead + found.length - 1
      }
    }
  }

  const title = list
    .filter((_, index) => !used.has(index))
    .map((word) => word.text)
    .join(' ')
    .trim()

  return { title, labels, assigneeId, priority, projectId, dueDate, tokens, unknown }
}

/** The line with one token's text taken out: what removing a chip by Backspace leaves. */
export function withoutToken(text: string, token: Pick<QuickAddToken, 'start' | 'end'>): string {
  return `${text.slice(0, token.start)}${text.slice(token.end)}`.replace(/\s{2,}/g, ' ').trim()
}
