import { useCallback, useEffect, useState } from 'react'
import type { PlanningBlockerWithWorkItem } from '@shared/ostler-api'
import { assertResult } from '../../utils/unwrap-result'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { Badge, Button, Card, InlineAlert } from '../../ui'
import { t } from '@shared/i18n'

/**
 * Every open `planning_blockers` row for the project, so agent-reported blockers
 * can be resolved from the Overview instead of the project Agents view.
 */
export function BlockersPanel({ ws, projectId }: { ws: PlanningWorkspace; projectId: string }) {
  const [blockers, setBlockers] = useState<PlanningBlockerWithWorkItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      const result = await window.ostlerAPI.listOpenBlockers(projectId)
      if (result.ok) setBlockers(result.value)
    } catch {
      // Best-effort; the panel simply stays at its last known state.
    }
  }, [projectId])

  // Main sends a planning change whenever a blocker is reported or resolved,
  // from the app or either API, so the panel follows the same notifications
  // as the rest of the Overview instead of polling.
  useEffect(() => {
    void load()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.projectId === projectId && update.field === 'planning') void load()
    })
  }, [load, projectId])

  const resolve = async (blockerId: string, choice: string) => {
    setBusyId(blockerId)
    setError(null)
    try {
      const result = await window.ostlerAPI.resolveBlocker(blockerId, choice, '')
      assertResult(result)
      setBlockers((current) => current.filter((blocker) => blocker.id !== blockerId))
    } catch (resolveError) {
      setError(
        resolveError instanceof Error
          ? resolveError.message
          : t('tasks:blockersPanel.couldntResolveBlockerTry')
      )
    } finally {
      setBusyId(null)
    }
  }

  if (blockers.length === 0 && !error) return null

  return (
    <Card as="section" aria-label={t('tasks:blockersPanel.blockers')} className="overview-panel">
      <h3 className="overview-panel__title">
        {t('tasks:blockersPanel.blockersReportedAgents')} <Badge>{blockers.length}</Badge>
      </h3>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      <ul className="overview-panel__list">
        {blockers.map((blocker) => (
          <li key={blocker.id} className="overview-blocker">
            <div className="overview-blocker__head">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const item = ws.workItems.find((candidate) => candidate.id === blocker.workItemId)
                  if (item) ws.openWorkItem(item)
                }}
              >
                {blocker.workItemCode ? `${blocker.workItemCode} · ` : ''}
                {blocker.workItemTitle}
              </Button>
              <span className="overview-muted">{formatAge(Date.now() - blocker.reportedAt)}</span>
            </div>
            <p>{blocker.description}</p>
            <div className="overview-blocker__options">
              {blocker.resolutionOptions.length > 0 ? (
                blocker.resolutionOptions.map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    disabled={busyId === blocker.id}
                    onClick={() => void resolve(blocker.id, option)}
                  >
                    {option}
                  </Button>
                ))
              ) : (
                <Button
                  size="sm"
                  disabled={busyId === blocker.id}
                  onClick={() => void resolve(blocker.id, 'resolved')}
                >
                  {t('tasks:blockersPanel.markResolved')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function formatAge(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60000)
  if (minutes < 60) return t('tasks:blockersPanel.minAgo', { minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('tasks:blockersPanel.hAgo', { hours })
  return t('tasks:blockersPanel.daysAgo', { count: Math.floor(hours / 24) })
}
