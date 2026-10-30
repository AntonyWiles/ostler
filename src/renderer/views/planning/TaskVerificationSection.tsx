import { useState } from 'react'
import type { PlanningWorkItem, TaskStatusReviewItem } from '@shared/ostler-api'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { assertResult } from '../../utils/unwrap-result'
import { useFeatures } from '../../navigation/features'
import { Badge, Button, InlineAlert, type BadgeTone } from '../../ui'
import { Sparkles } from '../../ui/icons'
import { TaskReviewPanel } from './TaskReviewPanel'
import { TaskDrawerSection } from './TaskDrawerSection'
import { t } from '@shared/i18n'
import { Trans } from '../../i18n/Trans'

const VERIFICATION: Record<string, { label: string; tone: BadgeTone }> = {
  unverified: {
    get label() {
      return t('tasks:taskVerificationSection.notCheckedYet')
    },
    tone: 'neutral'
  },
  pending: {
    get label() {
      return t('tasks:taskVerificationSection.waitingCheck')
    },
    tone: 'info'
  },
  passed: {
    get label() {
      return t('tasks:taskVerificationSection.passed')
    },
    tone: 'success'
  },
  failed: {
    get label() {
      return t('tasks:taskVerificationSection.failed')
    },
    tone: 'danger'
  },
  'needs-rework': {
    get label() {
      return t('tasks:taskVerificationSection.needsRework')
    },
    tone: 'warning'
  }
}

/**
 * Whether the agent's work on this task was checked, its review history, and
 * (with AI) a second opinion on the evidence. Shown while agents are on.
 */
export function TaskVerificationSection({
  ws,
  item
}: {
  ws: PlanningWorkspace
  item: PlanningWorkItem
}) {
  const features = useFeatures()
  const [busy, setBusy] = useState(false)
  const [finding, setFinding] = useState<TaskStatusReviewItem | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const status = VERIFICATION[item.verificationStatus] ?? {
    label: item.verificationStatus,
    tone: 'neutral' as const
  }

  const runReview = async () => {
    setBusy(true)
    setReviewError(null)
    try {
      const result = await window.ostlerAPI.reviewTaskStatus(item.projectId, [item.id])
      assertResult(result)
      setFinding(result.value.items[0] ?? null)
    } catch (error) {
      setReviewError(
        error instanceof Error
          ? error.message
          : t('tasks:taskVerificationSection.couldntReviewTaskTry')
      )
    } finally {
      setBusy(false)
    }
  }

  const accept = async () => {
    if (!finding) return
    setBusy(true)
    setReviewError(null)
    try {
      const result = await window.ostlerAPI.acceptTaskStatusReview(
        item.id,
        finding.recommendedVerification,
        finding.evidenceAssessment
      )
      assertResult(result)
      setFinding(null)
      await ws.loadPlanning()
    } catch (error) {
      setReviewError(
        error instanceof Error
          ? error.message
          : t('tasks:taskVerificationSection.couldntAcceptFindingTry')
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <TaskDrawerSection
      title={t('tasks:taskVerificationSection.verification')}
      collapsible
      defaultOpen={item.verificationStatus !== 'unverified'}
      actions={<Badge tone={status.tone}>{status.label}</Badge>}
    >
      {item.verificationNotes && <p className="task-drawer__text">{item.verificationNotes}</p>}
      <div className="task-drawer__row-actions">
        <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}>
          {t('tasks:taskVerificationSection.reviewHistory')}
        </Button>
        {features.ai && (
          <Button
            size="sm"
            variant="ai"
            icon={Sparkles}
            loading={busy}
            onClick={() => void runReview()}
          >
            {busy
              ? t('tasks:taskVerificationSection.checking')
              : t('tasks:taskVerificationSection.checkAi')}
          </Button>
        )}
      </div>
      {reviewError && <InlineAlert tone="danger">{reviewError}</InlineAlert>}
      {finding && (
        <div className="task-drawer__panel">
          <p className="task-drawer__text">{finding.evidenceAssessment}</p>
          {finding.concerns.length > 0 && (
            <ul className="task-drawer__bullets">
              {finding.concerns.map((concern) => (
                <li key={concern}>{concern}</li>
              ))}
            </ul>
          )}
          <p className="task-drawer__muted">
            <Trans
              i18nKey="tasks:taskVerificationSection.suggestsWithConfidence"
              values={{
                verification:
                  VERIFICATION[finding.recommendedVerification]?.label ??
                  finding.recommendedVerification,
                confidence: finding.confidence
              }}
              components={{ strong: <strong /> }}
            />
          </p>
          <div className="task-drawer__row-actions">
            <Button size="sm" variant="ghost" onClick={() => setFinding(null)}>
              {t('tasks:taskVerificationSection.dismiss')}
            </Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void accept()}>
              {t('tasks:taskVerificationSection.acceptFinding')}
            </Button>
          </div>
        </div>
      )}
      {historyOpen && (
        <TaskReviewPanel
          task={item}
          planningWorkItems={ws.workItems}
          onClose={() => setHistoryOpen(false)}
          onWorkItemCreated={() => void ws.loadPlanning()}
          onOpenWorkItem={(workItemId) => {
            const target = ws.workItems.find((candidate) => candidate.id === workItemId)
            if (target) {
              setHistoryOpen(false)
              ws.openWorkItem(target)
            }
          }}
        />
      )}
    </TaskDrawerSection>
  )
}
