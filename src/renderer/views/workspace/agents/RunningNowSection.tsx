import { useEffect, useState } from 'react'
import { formatDuration, formatRelativeTime } from '@shared/format'
import type { HarnessSession, HarnessTask } from '@shared/ostler-api'
import { sessionOwnsTask } from '../../../hooks/usePlanningWorkspace'
import { Badge, Button, useConfirm } from '../../../ui'
import { Eye } from '../../../ui/icons'
import { stopAgent } from './stop-agent'
import { SendGuidanceButton } from '../../planning/SendGuidance'
import { t } from '@shared/i18n'
import { agentRunStateLabel } from '@shared/agent-run-state'

type RunAction = (action: () => Promise<{ ok: boolean; error?: string }>) => Promise<boolean>

/** Re-renders once a minute, so "running for" and "last activity" stay true. */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

/**
 * The Agents view's Working now (simplify pass §7): each running agent's task,
 * how long it has run, what it did last, a notice when the project folder
 * switched versions since the task started (§4), Watch (the live
 * transcript), and Stop.
 */
export function RunningNowSection({
  projectId,
  sessions,
  tasks,
  busy,
  runHarnessAction,
  openTranscript,
  openSessionReview,
  folderVersion
}: {
  projectId: string
  sessions: HarnessSession[]
  tasks: HarnessTask[]
  /** The version the project folder is on now (§4). */
  folderVersion?: string | null
  busy: boolean
  runHarnessAction: RunAction
  openTranscript: (sessionId: string) => void
  openSessionReview: (sessionId: string) => void
}) {
  const confirm = useConfirm()
  const now = useMinuteTick()
  return (
    <section className="agents-section" aria-labelledby="agents-running-now">
      <header className="agents-section__header">
        <h3 id="agents-running-now">{t('agents:runningNowSection.runningNow')}</h3>
      </header>
      {sessions.length === 0 ? (
        <p className="agents-muted">{t('agents:runningNowSection.noAgentRunningQueued')}</p>
      ) : (
        <ul className="agents-list" aria-label={t('agents:runningNowSection.runningAgents')}>
          {sessions.map((session) => {
            const task = tasks.find((candidate) => sessionOwnsTask(session, candidate))
            const lastActivity = session.lastSeenAt ?? session.lastUpdate
            return (
              <li key={session.id} className="agents-list__row agents-running">
                <div className="agents-list__text">
                  <strong>
                    {task?.title ?? session.title}{' '}
                    {session.blocked && (
                      <Badge tone="warning">{agentRunStateLabel('waitingForYou')}</Badge>
                    )}
                  </strong>
                  <small>
                    {session.provenance === 'embedded'
                      ? t('agents:runningNowSection.runningForBuiltIn', {
                          duration: formatDuration(now - Date.parse(session.startedAt), {
                            long: true
                          })
                        })
                      : t('agents:runningNowSection.runningForConnected', {
                          duration: formatDuration(now - Date.parse(session.startedAt), {
                            long: true
                          })
                        })}
                  </small>
                  {folderVersion &&
                    session.workspace?.baseBranch &&
                    session.workspace.baseBranch !== folderVersion && (
                      <small>{t('agents:runningNowSection.versionSwitched')}</small>
                    )}
                  {task?.playbook && (
                    <small>
                      {t('agents:playbooks.fromPlaybook', { name: task.playbook.name })}
                    </small>
                  )}
                  {task?.scheduled && <small>{t('agents:playbooks.scheduled')}</small>}
                  {session.plan?.status === 'pending' && (
                    <small>{t('agents:planFirst.runWaits')}</small>
                  )}
                  <small>
                    {session.statusNote
                      ? t('agents:runningNowSection.lastActivityNote', {
                          when: formatRelativeTime(Date.parse(lastActivity), now),
                          note: session.statusNote
                        })
                      : t('agents:runningNowSection.lastActivityWhen', {
                          when: formatRelativeTime(Date.parse(lastActivity), now)
                        })}
                  </small>
                </div>
                <div className="agents-review__actions">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Eye}
                    aria-label={t('agents:runningNowSection.watchTitle', {
                      title: task?.title ?? session.title
                    })}
                    onClick={() => openTranscript(session.id)}
                  >
                    {t('agents:runningNowSection.watch')}
                  </Button>
                  <SendGuidanceButton
                    projectId={projectId}
                    session={session}
                    runTitle={task?.title ?? session.title}
                  />
                  <Button size="sm" variant="ghost" onClick={() => openSessionReview(session.id)}>
                    {t('agents:runningNowSection.details')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="agents-danger-text"
                    disabled={busy}
                    onClick={() =>
                      void stopAgent({
                        projectId,
                        session: { id: session.id, title: task?.title ?? session.title },
                        confirm,
                        runHarnessAction
                      })
                    }
                  >
                    {t('agents:stopAgent.stop')}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
