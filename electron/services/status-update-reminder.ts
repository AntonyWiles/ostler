import type { InboxItem, WatchedProject } from '@shared/ostler-api'
import { parseIsoDate } from '@shared/dates'
import { t } from '@shared/i18n'
import { updateReminderDue } from '@shared/status-updates'
import type { InboxSource } from './inbox-service'
import type { StatusUpdateService } from './status-update-service'

/**
 * The status update reminder (N5.5, N40): on a project's reminder day, while
 * nothing has been posted since that day began, the Inbox shows "Time for a
 * status update · Website", which opens the posting dialog. A new item each
 * reminder day, so its desktop notification (the reminders' setting) comes
 * once. On hold, Done and archived projects get none (`updateReminderDue`).
 */
export function statusUpdateReminderSource(
  updates: Pick<StatusUpdateService, 'latestPostedAt'>,
  getProjects: () => WatchedProject[],
  now: () => number = Date.now
): InboxSource {
  return () => {
    const projects = getProjects().filter(
      (project) => project.enabled && project.updateReminder?.cadence !== 'off'
    )
    if (projects.length === 0) return []
    const at = now()
    const posted = updates.latestPostedAt(projects.map((project) => project.id))
    return projects.flatMap((project): InboxItem[] => {
      const day = updateReminderDue(project, posted.get(project.id) ?? null, at)
      if (day === null) return []
      return [
        {
          key: `statusupdate:${project.id}:${day}`,
          kind: 'statusUpdate',
          title: t('desktop:inboxSources.statusUpdateDue', { projectName: project.name }),
          body: t('desktop:inboxSources.statusUpdateBody'),
          projectId: project.id,
          taskId: null,
          createdAt: parseIsoDate(day)?.getTime() ?? at
        }
      ]
    })
  }
}
