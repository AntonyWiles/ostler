import { t } from '@shared/i18n' /**
 * What to say aloud when agent runs change (P9.2): the running sessions
 * before and after a refresh, compared. Pure, so the words are tested once.
 */

export interface RunSnapshot {
  title: string
  projectName: string
  status: 'active' | 'blocked' | 'done'
}

/** Sessions by id. */
export type RunSnapshots = ReadonlyMap<string, RunSnapshot>

function runName(run: RunSnapshot): string {
  return run.title
    ? t('navigation:agentAnnouncements.in', { runTitle: run.title, projectName: run.projectName })
    : t('navigation:agentAnnouncements.run', { projectName: run.projectName })
}

export function agentRunAnnouncements(before: RunSnapshots, after: RunSnapshots): string[] {
  const messages: string[] = []
  for (const [id, run] of after) {
    const previous = before.get(id)
    if (!previous)
      messages.push(t('navigation:agentAnnouncements.agentStarted', { runName: runName(run) }))
    else if (previous.status !== run.status && run.status === 'blocked')
      messages.push(t('navigation:agentAnnouncements.agentBlocked', { runName: runName(run) }))
    else if (previous.status !== run.status && run.status === 'active')
      messages.push(t('navigation:agentAnnouncements.agentResumed', { runName: runName(run) }))
  }
  for (const [id, run] of before) {
    if (!after.has(id))
      messages.push(t('navigation:agentAnnouncements.agentRunEnded', { runName: runName(run) }))
  }
  return messages
}
