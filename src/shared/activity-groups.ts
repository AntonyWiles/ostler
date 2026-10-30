import type { ActivityEntry, ActivitySource } from './ostler-api'
import { BRAND } from './brand'
import { t } from './i18n'

/**
 * Grouped activity (R1.4): when one action creates or changes many tasks
 * (a template, the sample project, an import, an approved AI draft, a bulk
 * edit), a project's history shows one row that expands to the list. Each
 * task's own history is untouched; this only folds the project feed.
 *
 * Grouping reads only what the rows already record: neighbouring entries
 * with the same action, actor, wording and source (template, draft or
 * import batch), each for a different task, close together in time.
 */

/** Entries further apart than this are separate actions. */
export const ACTIVITY_GROUP_WINDOW_MS = 2 * 60 * 1000

export type ActivityFeedItem =
  | { kind: 'entry'; entry: ActivityEntry }
  | { kind: 'group'; id: string; summary: string; entries: ActivityEntry[] }

function sourceKey(source: ActivitySource | undefined): string {
  if (!source) return ''
  if (source.kind === 'template') return `template:${source.name}`
  if (source.kind === 'suggestion') return `suggestion:${source.draftId}`
  return `import:${source.batchId}`
}

/** What two entries must share to be one action. */
function groupKey(entry: ActivityEntry): string | null {
  if (entry.kind === 'comment' || entry.kind === 'status-update' || entry.kind === 'goal-check-in')
    return null
  return [
    entry.kind,
    entry.field ?? '',
    entry.actor.kind,
    entry.actor.personId ?? '',
    entry.actor.name,
    entry.summary,
    sourceKey(entry.source)
  ].join('\u0000')
}

/**
 * Folds a newest-first feed: two or more entries of one action become a
 * group, shown where its newest entry was. Other entries in between (a
 * task's repeat or a ticked checklist item, written in the same moment)
 * do not split it.
 */
export function groupActivity(
  entries: readonly ActivityEntry[],
  windowMs = ACTIVITY_GROUP_WINDOW_MS
): ActivityFeedItem[] {
  const slots: ActivityEntry[][] = []
  const open = new Map<string, { members: ActivityEntry[]; tasks: Set<string> }>()
  for (const entry of entries) {
    const key = groupKey(entry)
    const run = key === null ? undefined : open.get(key)
    const last = run?.members[run.members.length - 1]
    if (
      run &&
      last &&
      Math.abs(last.at - entry.at) <= windowMs &&
      !run.tasks.has(entry.workItemId)
    ) {
      run.members.push(entry)
      run.tasks.add(entry.workItemId)
      continue
    }
    const members = [entry]
    slots.push(members)
    if (key !== null) open.set(key, { members, tasks: new Set([entry.workItemId]) })
  }
  return slots.flatMap((members): ActivityFeedItem[] =>
    members.length >= 2
      ? [
          {
            kind: 'group',
            id: `group:${members[0].id}`,
            summary: summarizeGroup(members),
            entries: members
          }
        ]
      : [{ kind: 'entry', entry: members[0] }]
  )
}

/** "Alex added 12 tasks from the “Software project” template". */
export function summarizeGroup(entries: readonly ActivityEntry[]): string {
  const first = entries[0]
  const who = first.actor.name
  const count = entries.length
  if (first.kind === 'change' && first.field === 'created') {
    const source = first.source
    if (source?.kind === 'template')
      return t('tasks:activityGroups.addedFromTemplate', { who, count, name: `“${source.name}”` })
    if (source?.kind === 'suggestion')
      return t('tasks:activityGroups.addedFromSuggestion', { who, count, aiName: BRAND.aiName })
    if (source?.kind === 'import')
      return t('tasks:activityGroups.importedFrom', { who, count, fileName: source.fileName })
    return t('tasks:activityGroups.addedTasks', { who, count })
  }
  return t('tasks:activityGroups.sameChange', { who, count })
}
