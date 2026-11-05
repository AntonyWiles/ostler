import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { InboxEntry } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { itemPath, taskPath } from '../../navigation/paths'
import { Section } from '../../ui'
import { TaskLink } from '../planning/TaskPeek'
import './WaitingForSignOff.css'

/** Where a sign-off asked of Me opens: its task, decision or milestone. */
function pathOf(entry: InboxEntry): string | null {
  if (!entry.projectId) return null
  if (entry.taskId) return taskPath(entry.projectId, entry.taskId)
  if (entry.decisionId) return itemPath('decision', entry.projectId, entry.decisionId)
  if (entry.milestoneId) return itemPath('milestone', entry.projectId, entry.milestoneId)
  return null
}

/**
 * "Waiting for your sign-off" (prompt 17): the requests asked of Me, each opening its task,
 * decision or milestone. Nothing shows when there are none.
 */
export function WaitingForSignOff() {
  const [entries, setEntries] = useState<InboxEntry[]>([])

  useEffect(() => {
    const api = window.ostlerAPI
    const load = () => {
      if (typeof api?.getInbox !== 'function') return
      void api.getInbox().then((result) => {
        if (result?.ok) setEntries(result.value.items.filter((entry) => entry.kind === 'signOff'))
      })
    }
    load()
    if (typeof api?.onProjectStateChange !== 'function') return
    return api.onProjectStateChange((update) => {
      if (update.field === 'planning' || update.field === 'home') load()
    })
  }, [])

  if (entries.length === 0) return null
  return (
    <Section title={t('views:homeView.waitingForSignOff')}>
      <ul className="ostler-home-sign-offs">
        {entries.map((entry) => {
          const to = pathOf(entry)
          return (
            <li key={entry.key} className="ostler-home-sign-offs__row">
              {entry.projectId && entry.taskId ? (
                <TaskLink projectId={entry.projectId} taskId={entry.taskId}>
                  {entry.title}
                </TaskLink>
              ) : to ? (
                <Link to={to}>{entry.title}</Link>
              ) : (
                <span>{entry.title}</span>
              )}
              <span className="ostler-home-sign-offs__body">{entry.body}</span>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
