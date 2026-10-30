import { useState } from 'react'
import type { HarnessSession } from '@shared/ostler-api'
import { Badge, Button, Card } from '../../ui'
import { PlanDialog } from './PlanDialog'
import { t } from '@shared/i18n'

/** The runs waiting on the person to decide their plan (N9.3b). */
export function pendingPlanSessions(sessions: readonly HarnessSession[]): HarnessSession[] {
  return sessions.filter((session) => session.plan?.status === 'pending')
}

/**
 * Plans waiting for approval, in the Agents tab's "Needs you" beside agent
 * questions (N9.3b). Each opens the Plan dialog; the run waits until then.
 */
export function PendingPlansPanel({
  projectId,
  sessions,
  onDecided
}: {
  projectId: string
  sessions: readonly HarnessSession[]
  onDecided: () => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const waiting = pendingPlanSessions(sessions)
  if (waiting.length === 0) return null
  return (
    <Card as="section" aria-label={t('agents:planFirst.panelTitle')} className="overview-panel">
      <h3 className="overview-panel__title">
        {t('agents:planFirst.panelTitle')} <Badge>{waiting.length}</Badge>
      </h3>
      <ul className="overview-panel__list">
        {waiting.map((session) => (
          <li key={session.id} className="agents-list__row">
            <div className="agents-list__text">
              <strong>{session.title}</strong>
              <small>{t('agents:planFirst.panelRow', { version: session.plan!.version })}</small>
            </div>
            <Button
              size="sm"
              variant="primary"
              aria-label={t('agents:planFirst.openPlanFor', { title: session.title })}
              onClick={() => setOpenId(session.id)}
            >
              {t('agents:planFirst.openPlan')}
            </Button>
          </li>
        ))}
      </ul>
      {openId && (
        <PlanDialog
          projectId={projectId}
          sessionId={openId}
          onClose={() => setOpenId(null)}
          onDecided={onDecided}
        />
      )}
    </Card>
  )
}
