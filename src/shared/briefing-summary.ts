import type {
  Briefing,
  BriefingActorKind,
  BriefingByActor,
  BriefingList,
  BriefingProject,
  BriefingTask
} from './ostler-api'
import { BRAND } from './brand'
import { t } from './i18n'

/** Where a briefing line's items open. */
export type BriefingLinkKind = 'task' | 'agents' | 'inbox'

/** One line of the card: a sentence, its first titles and how many more there are. */
export interface BriefingLine {
  key: string
  text: string
  tasks: BriefingTask[]
  more: number
  link: BriefingLinkKind
}

/** "Alex", "agents", "rule “Escalate”", "an import"… */
export function briefingActorName(actor: BriefingActorKind, name: string | null): string {
  switch (actor) {
    case 'person':
      return name ?? t('views:briefing.someone')
    case 'agent':
      return t('views:briefing.agents')
    case 'rule':
      return name ? t('views:briefing.rule', { name }) : t('views:briefing.aRule')
    case 'import':
      return t('views:briefing.anImport')
    case 'automation':
      return t('views:briefing.automationApi')
    case 'ostler-ai':
      return BRAND.aiName
    case 'system':
      return BRAND.name
  }
}

function line(key: string, text: string, list: BriefingList, link: BriefingLinkKind): BriefingLine {
  return { key, text, tasks: list.tasks, more: Math.max(0, list.count - list.tasks.length), link }
}

function actorLines(prefix: 'finished' | 'added', groups: BriefingByActor[]): BriefingLine[] {
  return groups.map((group) =>
    line(
      `${prefix}:${group.actor}:${group.name ?? ''}`,
      t(`views:briefing.${prefix}`, {
        count: group.count,
        who: briefingActorName(group.actor, group.name)
      }),
      group,
      'task'
    )
  )
}

/**
 * One project's lines, in the card's order: finished, added, comments, due
 * dates passed, reminders, then the agents' runs, reviews and questions. A
 * line with nothing in it is left out. The card shows these words and
 * Listen reads them, so both say the same thing.
 */
export function briefingLines(project: BriefingProject): BriefingLine[] {
  const lines: BriefingLine[] = [
    ...actorLines('finished', project.finished),
    ...actorLines('added', project.added)
  ]
  const list = (key: string, value: BriefingList, link: BriefingLinkKind) => {
    if (value.count > 0)
      lines.push(line(key, t(`views:briefing.${key}`, { count: value.count }), value, link))
  }
  list('comments', project.comments, 'task')
  list('overdue', project.overdue, 'task')
  list('reminders', project.reminders, 'task')
  list('runsFinished', project.runsFinished, 'agents')
  list('runsInReview', project.runsInReview, 'agents')
  if (project.questions > 0) {
    lines.push(
      line(
        'questions',
        t('views:briefing.questions', { count: project.questions }),
        { count: 0, tasks: [] },
        'inbox'
      )
    )
  }
  return lines
}

/** "and 214 more". */
export function briefingMoreText(more: number): string {
  return t('views:briefing.more', { count: more })
}

/**
 * What Listen reads, in the card's order: each project's name, then each
 * line's sentence with its titles and "and 214 more".
 */
export function briefingSpeech(briefing: Briefing): string[] {
  if (briefing.projects.length === 0) return [t('views:briefing.nothingHappened')]
  return briefing.projects.flatMap((project) => [
    project.projectName,
    ...briefingLines(project).map((entry) =>
      [
        entry.text,
        ...entry.tasks.map((task) => task.title),
        ...(entry.more > 0 ? [briefingMoreText(entry.more)] : [])
      ].join('. ')
    )
  ])
}
