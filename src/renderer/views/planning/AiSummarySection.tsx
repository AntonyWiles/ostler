import type { AIProjectBrief } from '@shared/ostler-api'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { useFeatures } from '../../navigation/features'
import { AiWarnings } from '../../components/AiByline'
import { Badge, Button, Card, InlineAlert, Section, TextArea } from '../../ui'
import { ChevronRight, Icon } from '../../ui/icons'
import { HealthBadge } from './HealthBadge'
import { t } from '@shared/i18n'
import { formatDateTime, formatRelativeTime } from '@shared/format'

/** A summary older than this describes a project state the board has likely left behind. */
export const SUMMARY_STALE_AFTER_MS = 24 * 60 * 60 * 1000

export function summaryIsStale(generatedAt: string, now: number = Date.now()): boolean {
  return now - new Date(generatedAt).getTime() > SUMMARY_STALE_AFTER_MS
}

type BriefAction = AIProjectBrief['nextActions'][number]

/**
 * The Overview's AI summary: Ostler AI's read of the plan and agent activity,
 * labelled with its age. A summary is a snapshot that reads as a live
 * statement of fact; one left for a day claimed the project had no goals or
 * work items while the board showed thirty, so past a day it says loudly
 * that it is out of date.
 */
export function AiSummarySection({ ws }: { ws: PlanningWorkspace }) {
  const brief = ws.projectBrief
  const stale = brief ? summaryIsStale(brief.generatedAt) : false

  return (
    <Section
      title={t('ai:aiSummarySection.aiSummary')}
      description={
        brief ? (
          <span
            title={formatDateTime(new Date(brief.generatedAt), {
              dateStyle: 'short',
              timeStyle: 'medium'
            })}
          >
            {t('ai:aiSummarySection.summary', {
              when: formatRelativeTime(new Date(brief.generatedAt).getTime()),
              model: brief.model
            })}
          </span>
        ) : undefined
      }
      actions={
        <Button variant="ai" loading={ws.busy} onClick={() => void ws.generateProjectBrief()}>
          {brief ? t('ai:aiSummarySection.refreshSummary') : t('ai:aiSummarySection.writeSummary')}
        </Button>
      }
    >
      {!brief ? (
        <Card>
          <p className="overview-quiet">{t('ai:aiSummarySection.canSumUpPlan')}</p>
        </Card>
      ) : (
        <Card className="overview-summary">
          {stale && (
            <InlineAlert tone="warning" title={t('ai:aiSummarySection.outDate')}>
              {t('ai:aiSummarySection.summaryDescribesProjectWas', {
                when: formatRelativeTime(new Date(brief.generatedAt).getTime())
              })}
            </InlineAlert>
          )}
          <div className="overview-summary__head">
            <h3>{brief.headline}</h3>
            <HealthBadge
              verdict={{ health: brief.health, reason: t('ai:aiSummarySection.sViewProject') }}
            />
          </div>
          <p>{brief.summary}</p>
          {brief.risks.length > 0 && (
            <div>
              <h4 className="overview-summary__label">{t('ai:aiSummarySection.risks')}</h4>
              <ul className="overview-summary__list">
                {brief.risks.map((risk) => (
                  <li key={risk}>{risk}</li>
                ))}
              </ul>
            </div>
          )}
          <AiWarnings warnings={brief.warnings} />
          {brief.nextActions.length > 0 && <BriefActions ws={ws} brief={brief} />}
        </Card>
      )}
    </Section>
  )
}

/** The summary's recommendations, each reviewed on its own before anything is created. */
function BriefActions({ ws, brief }: { ws: PlanningWorkspace; brief: AIProjectBrief }) {
  const allCreated = brief.nextActions.every(
    (action) => action.reviewStatus === 'approved' && action.creation
  )
  return (
    <details
      className="overview-disclosure"
      open={ws.briefTab === 'recommendations'}
      onToggle={(event) =>
        ws.setBriefTab(
          (event.currentTarget as HTMLDetailsElement).open ? 'recommendations' : 'overview'
        )
      }
    >
      <summary>
        <Icon icon={ChevronRight} className="overview-disclosure__chevron" />
        {t('ai:aiSummarySection.recommendations')} <Badge>{brief.nextActions.length}</Badge>
      </summary>
      {allCreated ? (
        <InlineAlert tone="success" title={t('ai:aiSummarySection.allRecommendationsCreated')}>
          {t('ai:aiSummarySection.everyRecommendationSummaryWas')}
        </InlineAlert>
      ) : (
        <p className="overview-muted">
          {t('ai:aiSummarySection.recommendationsApproveOneBefore', {
            count: brief.nextActions.length
          })}
        </p>
      )}
      <ol className="overview-actions">
        {brief.nextActions.map((action, index) => (
          <BriefActionItem key={action.id || `${action.title}-${index}`} ws={ws} action={action} />
        ))}
      </ol>
    </details>
  )
}

const REVIEW_BADGE = {
  created: {
    tone: 'success',
    get label() {
      return t('ai:aiSummarySection.created2')
    }
  },
  approved: {
    tone: 'info',
    get label() {
      return t('ai:aiSummarySection.approved')
    }
  },
  rejected: {
    tone: 'neutral',
    get label() {
      return t('ai:aiSummarySection.rejected')
    }
  },
  pending: {
    tone: 'neutral',
    get label() {
      return t('ai:aiSummarySection.notReviewed')
    }
  }
} as const

function BriefActionItem({ ws, action }: { ws: PlanningWorkspace; action: BriefAction }) {
  const features = useFeatures()
  const state = action.creation ? 'created' : (action.reviewStatus ?? 'pending')
  const badge = REVIEW_BADGE[state as keyof typeof REVIEW_BADGE] ?? REVIEW_BADGE.pending
  const locked = ws.busy || Boolean(action.creation)
  const approved = action.reviewStatus === 'approved'
  return (
    <li className="overview-action">
      <div className="overview-action__head">
        <strong>{action.title}</strong>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <p>{action.rationale}</p>
      {action.evidence.length > 0 && (
        <p className="overview-muted">
          {t('ai:aiSummarySection.evidence', { join: action.evidence.join(' · ') })}
        </p>
      )}
      <TextArea
        label={t('ai:aiSummarySection.notes')}
        rows={2}
        value={ws.briefActionNotes[action.id] ?? action.reviewNotes ?? ''}
        onChange={(event) =>
          ws.setBriefActionNotes((current) => ({ ...current, [action.id]: event.target.value }))
        }
        placeholder={t('ai:aiSummarySection.constraintsFeedbackBeforeRegenerate')}
      />
      <div className="overview-action__buttons">
        <Button
          size="sm"
          disabled={locked}
          onClick={() => void ws.reviewBriefAction(action, 'approved')}
        >
          {t('ai:aiSummarySection.approve')}
        </Button>
        <Button
          size="sm"
          disabled={locked}
          onClick={() => void ws.reviewBriefAction(action, 'rejected')}
        >
          {t('ai:aiSummarySection.reject')}
        </Button>
        <Button
          size="sm"
          variant="ai"
          disabled={locked}
          onClick={() => void ws.regenerateBriefAction(action)}
        >
          {t('ai:aiSummarySection.regenerate')}
        </Button>
      </div>
      <div
        className="overview-action__buttons"
        aria-label={t('ai:aiSummarySection.create', { actionTitle: action.title })}
      >
        {action.creation ? (
          <>
            <span className="overview-muted">
              {t(`ai:aiSummarySection.createdAs.${action.creation.type}`)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={ws.busy}
              onClick={() => void ws.undoBriefActionCreation(action)}
            >
              {t('ai:aiSummarySection.undoCreation')}
            </Button>
          </>
        ) : (
          <>
            <span className="overview-muted">{t('ai:aiSummarySection.create2')}</span>
            <Button
              size="sm"
              disabled={ws.busy || !approved}
              disabledReason={approved ? undefined : t('ai:aiSummarySection.approveFirst')}
              onClick={() => void ws.createFromBriefAction(action, 'goal')}
            >
              {t('ai:aiSummarySection.goal')}
            </Button>
            <Button
              size="sm"
              disabled={ws.busy || !approved}
              disabledReason={approved ? undefined : t('ai:aiSummarySection.approveFirst')}
              onClick={() => void ws.createFromBriefAction(action, 'milestone')}
            >
              {t('ai:aiSummarySection.milestone')}
            </Button>
            {features.agents && (
              <Button
                size="sm"
                disabled={ws.busy || !approved}
                disabledReason={approved ? undefined : t('ai:aiSummarySection.approveFirst')}
                title={t('ai:aiSummarySection.createTaskQueueAgent')}
                onClick={() => void ws.createFromBriefAction(action, 'work-item')}
              >
                {t('ai:aiSummarySection.taskAgent')}
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  )
}
