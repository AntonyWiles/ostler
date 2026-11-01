import { useState } from 'react'
import type {
  AIMilestoneAction,
  AIMilestoneAdvisory,
  PlanningMilestone,
  PlanningMilestoneStatus,
  PlanningReadinessReport
} from '@shared/ostler-api'
import { buildReadinessReport } from '@shared/planning-readiness'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { useFeatures } from '../../navigation/features'
import { AiWarnings } from '../../components/AiByline'
import {
  Badge,
  Button,
  Card,
  IconButton,
  InlineAlert,
  Menu,
  ProgressBar,
  Select,
  StatusBadge,
  type BadgeTone
} from '../../ui'
import {
  CircleAlert,
  ChevronRight,
  CircleCheck,
  Ellipsis,
  Icon,
  Pause,
  Pencil,
  Repeat,
  ScrollText,
  SkipForward,
  Trash2,
  TriangleAlert
} from '../../ui/icons'
import { HealthBadge } from './HealthBadge'
import { SignOffSection } from './SignOffSection'
import { SignOffBadge } from './SignOffBadge'
import { MilestoneDue } from './MilestoneDue'
import type { MilestoneProgress } from './milestone-progress'
import './MilestoneCard.css'
import { t } from '@shared/i18n'
import { SubprojectChip } from './subproject-ui'
import { formatDateTime, formatRelativeTime } from '@shared/format'
import { HEALTH_TONE } from '@shared/planning/health'
import { pinEntries, usePins } from '../../pins/PinsProvider'
import { formatIsoDate } from '@shared/dates'
import { describeRecurrence } from '@shared/recurrence'
import './rounds/rounds.css'

/** What a milestone's menu offers for its rounds (N5.7a); each left out when not offered. */
export interface RoundActions {
  repeat?: () => void
  startNow?: () => void
  stop?: () => void
}

/** "Repeats monthly on the 1st. Next round: 1 May 2027", or that it stopped. */
function repeatText(milestone: PlanningMilestone): string | null {
  const repeat = milestone.repeat
  if (!repeat) return null
  if (!repeat.on) return t('tasks:rounds.stoppedRepeating')
  return t('tasks:rounds.repeatsNext', {
    rule: describeRecurrence(repeat.rule),
    date: formatIsoDate(repeat.nextStart)
  })
}

export const MILESTONE_STATUS_OPTIONS: { value: PlanningMilestoneStatus; label: string }[] = [
  {
    value: 'planned',
    get label() {
      return t('tasks:milestoneCard.planned')
    }
  },
  {
    value: 'active',
    get label() {
      return t('tasks:milestoneCard.active')
    }
  },
  {
    value: 'complete',
    get label() {
      return t('tasks:milestoneCard.complete')
    }
  },
  {
    value: 'archived',
    get label() {
      return t('tasks:milestoneCard.archived')
    }
  }
]

/**
 * The one thing to do next on a milestone. Green metrics and a row of passing
 * checks say nothing is wrong; they never say what to do, which left a healthy
 * milestone looking finished when its work had not started. Deterministic and
 * ordered most-urgent first, so the card never argues with the health badge.
 */
interface NextStep {
  label: string
  detail: string
  action?: { label: string; run: () => void }
}

export function nextStepFor(
  milestone: PlanningMilestone,
  progress: MilestoneProgress,
  ws: Pick<PlanningWorkspace, 'openWorkItemCreate' | 'openWorkItem' | 'setMilestoneStatus'>
): NextStep {
  const { linked, byStatus, overdue } = progress
  if (linked.length === 0)
    return {
      label: t('tasks:milestoneCard.linkSomeWork'),
      detail: t('tasks:milestoneCard.milestoneHasNoLinked'),
      action: {
        label: t('tasks:milestoneCard.addFirstTask'),
        run: () => ws.openWorkItemCreate('backlog', milestone.id)
      }
    }

  if (byStatus.blocked.length > 0)
    return {
      label: t('tasks:milestoneCard.unblockTasks', { count: byStatus.blocked.length }),
      detail: t('tasks:milestoneCard.blockedWorkStopsMilestone'),
      action: {
        label: t('tasks:milestoneCard.open', { title: byStatus.blocked[0].title }),
        run: () => ws.openWorkItem(byStatus.blocked[0])
      }
    }

  // All done beats a due date, as in the health rule: nothing is left to be late.
  if (byStatus.done.length === linked.length && milestone.status !== 'complete')
    return {
      label: t('tasks:milestoneCard.everyLinkedTaskDone'),
      detail: t('tasks:milestoneCard.nothingLeftDeliverBut'),
      action: {
        label: t('tasks:milestoneCard.markComplete'),
        run: () => void ws.setMilestoneStatus(milestone, 'complete')
      }
    }

  if (overdue)
    return {
      label: t('tasks:milestoneCard.pastDueDate'),
      detail: t('tasks:milestoneCard.moveDateCutScope')
    }

  if (byStatus.done.length === linked.length)
    return {
      label: t('tasks:milestoneCard.complete'),
      detail: t('tasks:milestoneCard.everyLinkedItemDone')
    }

  if (byStatus.review.length > 0)
    return {
      label: t('tasks:milestoneCard.reviewTasks', { count: byStatus.review.length }),
      detail: t('tasks:milestoneCard.finishedWorkWaitingCheck'),
      action: {
        label: t('tasks:milestoneCard.open', { title: byStatus.review[0].title }),
        run: () => ws.openWorkItem(byStatus.review[0])
      }
    }

  if (byStatus.active.length === 0 && byStatus.ready.length > 0)
    return {
      label: t('tasks:milestoneCard.nothingProgress'),
      detail: t('tasks:milestoneCard.tasksReadyStart', { count: byStatus.ready.length }),
      action: {
        label: t('tasks:milestoneCard.start', { title: byStatus.ready[0].title }),
        run: () => ws.openWorkItem(byStatus.ready[0])
      }
    }

  if (byStatus.active.length === 0)
    return {
      label: t('tasks:milestoneCard.nothingProgress'),
      detail: t('tasks:milestoneCard.allRemainingTasksStill', { count: byStatus.backlog.length }),
      action: {
        label: t('tasks:milestoneCard.refine', { title: byStatus.backlog[0].title }),
        run: () => ws.openWorkItem(byStatus.backlog[0])
      }
    }

  if (milestone.status === 'planned')
    return {
      label: t('tasks:milestoneCard.workHasStarted'),
      detail: t('tasks:milestoneCard.milestoneStillReadsPlanned'),
      action: {
        label: t('tasks:milestoneCard.markActive'),
        run: () => void ws.setMilestoneStatus(milestone, 'active')
      }
    }

  return {
    label: t('tasks:milestoneCard.progress2', { activeCount: byStatus.active.length }),
    detail: t('tasks:milestoneCard.nothingNeedsDecisionRight')
  }
}

const VERDICT: Record<
  PlanningReadinessReport['verdict'],
  { tone: BadgeTone; label: string; icon: typeof CircleCheck }
> = {
  ready: {
    tone: 'success',
    get label() {
      return t('tasks:milestoneCard.readyRelease')
    },
    icon: CircleCheck
  },
  attention: {
    tone: 'warning',
    get label() {
      return t('tasks:milestoneCard.needsLook')
    },
    icon: TriangleAlert
  },
  'not-ready': {
    tone: 'danger',
    get label() {
      return t('tasks:milestoneCard.notReady')
    },
    icon: CircleAlert
  }
}

const CHECK_ICON = { pass: CircleCheck, warning: TriangleAlert, fail: CircleAlert } as const

/**
 * One milestone: its name and outcome, progress from linked tasks, due date,
 * health, the readiness verdict with its checks behind a disclosure, the next
 * step, and with AI on the advisory with its age.
 */
export function MilestoneCard({
  ws,
  milestone,
  progress,
  advisory,
  reviewing,
  reviewDisabled,
  onReview,
  onEdit,
  onStatusChange,
  onDelete,
  onWriteReleaseNotes,
  rounds,
  costTotal,
  baselineText
}: {
  ws: PlanningWorkspace
  milestone: PlanningMilestone
  progress: MilestoneProgress
  advisory: AIMilestoneAdvisory | null
  reviewing: boolean
  reviewDisabled: boolean
  onReview: (selectedItemIds?: string[]) => void
  onEdit: () => void
  onStatusChange: (status: PlanningMilestoneStatus) => void
  onDelete: () => void
  /** Write release notes (N9.9): opens the dialog for this milestone. */
  onWriteReleaseNotes: () => void
  /** Repeat this round, Start next round now and Stop repeating (N5.7a). */
  rounds?: RoundActions
  /** The milestone's costs (N6.3a), formatted; absent when it has none. */
  costTotal?: string
  /** How far it has moved against a baseline (N7.4), in words; absent with none. */
  baselineText?: string | null
}) {
  const features = useFeatures()
  // Real counts: these checks used to be handed zeroes, so they passed on
  // every card and the whole row read green no matter the state.
  const readiness = buildReadinessReport(milestone.id, {
    items: progress.linked,
    metrics: new Map(),
    reviewCount: ws.reviewSessions.length,
    pendingQuestionCount: ws.pendingQuestions.length,
    gitDirty: false,
    gitConflicted: 0
  })
  const verdict = VERDICT[readiness.verdict]
  const nextStep = nextStepFor(milestone, progress, ws)
  // Evidence moved on if anything linked changed after the review, so an old
  // verdict is labelled rather than shown as current.
  const advisoryStale =
    advisory !== null &&
    [milestone.updatedAt, ...progress.linked.map((item) => item.updatedAt)].some(
      (updatedAt) => updatedAt > Date.parse(advisory.generatedAt)
    )
  const done = progress.byStatus.done.length
  const pins = usePins()
  const repeating = repeatText(milestone)

  return (
    <Card as="article" className="milestone-card" aria-label={milestone.name}>
      <header className="milestone-card__head">
        <h3 className="milestone-card__name" title={milestone.name}>
          {milestone.name}
        </h3>
        <HealthBadge verdict={progress.health} />
        <Menu
          label={t('tasks:milestoneCard.moreActions', { milestoneName: milestone.name })}
          placement="bottom-end"
          items={[
            { label: t('tasks:milestoneCard.edit'), icon: Pencil, onSelect: onEdit },
            // Rounds (N5.7a).
            ...(rounds?.repeat
              ? [
                  {
                    label: milestone.repeat?.on
                      ? t('tasks:rounds.changeRepeat')
                      : t('tasks:rounds.repeatThisRound'),
                    icon: Repeat,
                    onSelect: rounds.repeat
                  }
                ]
              : []),
            ...(rounds?.startNow
              ? [
                  {
                    label: t('tasks:rounds.startNextRoundNow'),
                    icon: SkipForward,
                    onSelect: rounds.startNow
                  }
                ]
              : []),
            ...(rounds?.stop
              ? [{ label: t('tasks:rounds.stopRepeating'), icon: Pause, onSelect: rounds.stop }]
              : []),
            {
              label: t('tasks:releaseNotes.write'),
              icon: ScrollText,
              onSelect: onWriteReleaseNotes
            },
            {
              label: t('tasks:milestoneCard.delete'),
              icon: Trash2,
              tone: 'danger',
              onSelect: onDelete
            },
            // Pins (N5.2a).
            ...pinEntries(pins, {
              kind: 'milestone',
              targetId: milestone.id,
              projectId: milestone.projectId,
              title: milestone.name
            })
          ]}
          renderTrigger={(trigger) => (
            <IconButton
              {...trigger}
              label={t('tasks:milestoneCard.moreActions', { milestoneName: milestone.name })}
              icon={Ellipsis}
              size="sm"
            />
          )}
        />
      </header>
      {milestone.outcome && <p className="milestone-card__outcome">{milestone.outcome}</p>}
      {repeating && (
        <p className="milestone-card__repeat">
          <Icon icon={Repeat} />
          {repeating}
        </p>
      )}

      <ProgressBar
        label={t('tasks:milestoneCard.progress')}
        showLabel
        value={done}
        max={Math.max(progress.linked.length, 1)}
        valueText={t('tasks:milestoneCard.tasksDone', { count: progress.linked.length, done })}
        tone={HEALTH_TONE[progress.health.health] === 'success' ? 'success' : 'accent'}
      />

      <div className="milestone-card__meta">
        <MilestoneDue milestone={milestone} />
        <SignOffBadge projectId={milestone.projectId} itemId={milestone.id} />
        {/* A scoped view holds one workstream, so the chip would say the same on every card. */}
        {!ws.subprojectScope && (
          <SubprojectChip
            className="milestone-card__subproject"
            subprojects={ws.subprojects}
            subprojectId={milestone.subprojectId}
          />
        )}
        {costTotal && (
          <p className="milestone-card__costs">
            {t('projects:costs.milestoneTotal', { amount: costTotal })}
          </p>
        )}
        <Select
          label={t('tasks:milestoneCard.milestoneStatus', { milestoneName: milestone.name })}
          hideLabel
          size="sm"
          value={milestone.status}
          disabled={ws.busy}
          options={MILESTONE_STATUS_OPTIONS}
          onChange={(event) => onStatusChange(event.target.value as PlanningMilestoneStatus)}
        />
      </div>
      {baselineText && <p className="milestone-card__baseline">{baselineText}</p>}

      <div className="milestone-card__next" aria-label={t('tasks:milestoneCard.nextStep')}>
        <p>
          <strong>{nextStep.label}.</strong> {nextStep.detail}
        </p>
        {nextStep.action && (
          <Button
            size="sm"
            className="milestone-card__next-action"
            title={nextStep.action.label}
            disabled={ws.busy}
            onClick={nextStep.action.run}
          >
            <span className="milestone-card__next-label">{nextStep.action.label}</span>
          </Button>
        )}
      </div>

      <SignOffSection
        projectId={milestone.projectId}
        item={{ kind: 'milestone', id: milestone.id }}
      />

      <details className="milestone-card__disclosure">
        <summary>
          <Icon icon={ChevronRight} className="milestone-card__chevron" />
          <Badge tone={verdict.tone} icon={verdict.icon}>
            {verdict.label}
          </Badge>
          <span>{t('tasks:milestoneCard.readinessChecks')}</span>
        </summary>
        <ul
          className="milestone-card__checks"
          aria-label={t('tasks:milestoneCard.releaseReadiness')}
        >
          {readiness.checks.map((check) => (
            <li key={check.id} data-state={check.state}>
              <Icon icon={CHECK_ICON[check.state]} />
              <span>
                <strong>{check.label}</strong>
                <span className="milestone-card__muted"> {check.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </details>

      {progress.linked.length > 0 && (
        <details className="milestone-card__disclosure">
          <summary>
            <Icon icon={ChevronRight} className="milestone-card__chevron" />
            {t('tasks:milestoneCard.tasks', { linkedCount: progress.linked.length })}
          </summary>
          <ul className="milestone-card__tasks">
            {progress.linked.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => ws.openWorkItem(item)}>
                  <StatusBadge
                    status={ws.projectedStatus(item)}
                    columnId={item.columnId}
                    iconOnly
                  />
                  <span title={item.title}>{item.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {features.ai && (
        <section
          className="milestone-card__advisory"
          aria-label={t('tasks:milestoneCard.aiReview')}
        >
          <div className="milestone-card__advisory-head">
            <h4>{t('tasks:milestoneCard.aiReview')}</h4>
            <Button
              size="sm"
              variant="ai"
              loading={reviewing}
              disabled={reviewDisabled}
              onClick={() => onReview()}
            >
              {advisory ? t('tasks:milestoneCard.reviewAgain') : t('tasks:milestoneCard.reviewAi')}
            </Button>
          </div>
          {!advisory ? (
            <p className="milestone-card__muted">{t('tasks:milestoneCard.notReviewedYetReads')}</p>
          ) : (
            <>
              {advisoryStale && (
                <InlineAlert tone="warning">
                  {t('tasks:milestoneCard.workHasChangedSince')}
                </InlineAlert>
              )}
              <div className="milestone-card__advisory-headline">
                <HealthBadge
                  verdict={{ health: advisory.health, reason: t('tasks:milestoneCard.sView') }}
                />
                <strong>{advisory.headline}</strong>
              </div>
              <p>{advisory.summary}</p>
              {advisory.recommendations.length > 0 && (
                <>
                  <h5 className="milestone-card__list-head">{t('tasks:milestoneCard.toDecide')}</h5>
                  <ul className="milestone-card__list">
                    {advisory.recommendations.map((recommendation) => (
                      <li key={recommendation.title}>
                        <strong>{recommendation.title}.</strong> {recommendation.rationale}
                        {recommendation.action && (
                          <AdvisoryActionButton
                            ws={ws}
                            milestone={milestone}
                            linked={progress.linked}
                            action={recommendation.action}
                            disabled={ws.busy || reviewing || reviewDisabled}
                            onReview={onReview}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {advisory.risks.length > 0 && (
                <>
                  <h5 className="milestone-card__list-head">{t('tasks:milestoneCard.risks')}</h5>
                  <ul className="milestone-card__list">
                    {advisory.risks.map((risk) => (
                      <li key={risk}>{risk}</li>
                    ))}
                  </ul>
                </>
              )}
              <AiWarnings warnings={advisory.warnings} />
              <p
                className="milestone-card__muted"
                title={formatDateTime(new Date(advisory.generatedAt), {
                  dateStyle: 'short',
                  timeStyle: 'medium'
                })}
              >
                {t('tasks:milestoneCard.reviewed', {
                  when: formatRelativeTime(new Date(advisory.generatedAt).getTime()),
                  model: advisory.model
                })}
              </p>
            </>
          )}
        </section>
      )}
    </Card>
  )
}

/**
 * The one edit a recommendation proposes, applied only when the owner clicks.
 * Once applied the button says so, so a second click cannot add it twice.
 */
function AdvisoryActionButton({
  ws,
  milestone,
  linked,
  action,
  disabled,
  onReview
}: {
  ws: PlanningWorkspace
  milestone: PlanningMilestone
  linked: MilestoneProgress['linked']
  action: AIMilestoneAction
  disabled: boolean
  onReview: (selectedItemIds?: string[]) => void
}) {
  const [applied, setApplied] = useState(false)
  const task =
    action.kind === 'add-acceptance-criterion'
      ? linked.find((item) => item.id === action.workItemId)
      : undefined
  const already =
    applied ||
    (action.kind === 'add-success-criterion' && milestone.successCriteria.includes(action.text)) ||
    (action.kind === 'add-acceptance-criterion' &&
      task?.acceptanceCriteria.includes(action.text) === true)
  if (action.kind === 'add-acceptance-criterion' && !task) return null

  const run = async () => {
    switch (action.kind) {
      case 'add-task':
        ws.openWorkItemCreate('backlog', milestone.id)
        ws.setItemTitle(action.title)
        ws.setItemDescription(action.description)
        return
      case 'add-success-criterion':
        await ws.addMilestoneSuccessCriterion(milestone, action.text)
        setApplied(true)
        return
      case 'add-acceptance-criterion':
        if (
          task &&
          (await ws.updateWorkItemInline(task, {
            acceptanceCriteria: [...task.acceptanceCriteria, action.text]
          }))
        )
          setApplied(true)
        return
      case 'include-library-item':
        onReview([action.itemId])
        return
    }
  }

  // The button stays a short verb; what it adds is quoted above it, so a long
  // criterion wraps as text instead of overflowing a one-line button.
  const label =
    action.kind === 'add-task'
      ? t('tasks:milestoneCard.actionAddTask')
      : action.kind === 'add-success-criterion'
        ? t('tasks:milestoneCard.actionAddSuccessCriterion')
        : action.kind === 'add-acceptance-criterion'
          ? t('tasks:milestoneCard.actionAddAcceptanceCriterion')
          : t('tasks:milestoneCard.actionIncludeAndReview')
  const target = action.kind === 'add-acceptance-criterion' ? task?.title : undefined
  const proposed =
    action.kind === 'add-task'
      ? action.title
      : action.kind === 'include-library-item'
        ? action.title
        : action.text

  return (
    <div className="milestone-card__action">
      <p className="milestone-card__proposed">
        {target && <span className="milestone-card__muted">{target}: </span>}
        {proposed}
      </p>
      <Button
        size="sm"
        variant="secondary"
        icon={already ? CircleCheck : undefined}
        disabled={disabled || already}
        onClick={() => void run()}
      >
        {already ? t('tasks:milestoneCard.actionApplied') : label}
      </Button>
    </div>
  )
}
