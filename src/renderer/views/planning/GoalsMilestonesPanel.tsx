import { useEffect, useState } from 'react'
import { LinkedFrom } from '../../components/LinkedFrom'
import { useOptionalSearchParams } from '../../hooks/useOptionalSearchParams'
import type {
  AIMilestoneAdvisory,
  PlanningGoal,
  PlanningGoalStatus,
  PlanningIteration,
  PlanningMilestone,
  PlanningMilestoneStatus,
  PlanningSubproject,
  TaskSplitJob
} from '@shared/ostler-api'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import {
  Button,
  Dialog,
  EmptyState,
  IconButton,
  InlineAlert,
  Menu,
  Select,
  TextArea,
  TextField,
  toIsoDate,
  useConfirm,
  useToast
} from '../../ui'
import {
  Archive,
  Ellipsis,
  IterationCw,
  Milestone,
  Pencil,
  Plus,
  Target,
  Trash2
} from '../../ui/icons'
import { canPlanAndSplit, useFeatures } from '../../navigation/features'
import { MilestoneCard, type RoundActions } from './MilestoneCard'
import { RepeatRoundDialog } from './rounds/RepeatRoundDialog'
import { CompareRoundsDialog } from './rounds/CompareRoundsDialog'
import { groupRounds } from '@shared/milestone-rounds'
import { ReleaseNotesDialog } from './ReleaseNotesDialog'
import type { ReleaseNotesSource } from '@shared/release-notes'
import { SuccessCriteriaEditor } from './SuccessCriteriaEditor'
import { milestoneProgress } from './milestone-progress'
import { IterationsSection } from '../../iterations/IterationsSection'
import { IterationDialog } from '../../iterations/IterationDialog'
import { FinishIterationDialog } from '../../iterations/FinishIterationDialog'
import { useProjectEstimateUnit } from '../../context/OstlerContext'
import { GoalMeasureSection } from './goal-measure/GoalMeasureSection'
import { useGoalCheckIns } from './goal-measure/useGoalCheckIns'
import { CountsTowardsDialog, CountsTowardsLine } from './goal-measure/CountsTowards'
import { useCountsTowards } from '../goals/usePersonalGoals'
import './GoalsMilestonesPanel.css'
import './planning-dialogs.css'
import '../../costs/costs.css'
import { useMoneySummary } from '../../costs/useMoney'
import { useMilestoneBaseline } from './baselines/useMilestoneBaseline'
import { formatMoney } from '@shared/money'
import { t } from '@shared/i18n'
import { SubprojectField } from './subproject-ui'

const GOAL_STATUS_OPTIONS: { value: PlanningGoalStatus; label: string }[] = [
  {
    value: 'active',
    get label() {
      return t('tasks:goalsMilestonesPanel.active')
    }
  },
  {
    value: 'achieved',
    get label() {
      return t('tasks:goalsMilestonesPanel.achieved')
    }
  },
  {
    value: 'archived',
    get label() {
      return t('tasks:goalsMilestonesPanel.archived2')
    }
  }
]

/**
 * The background task split for each goal that has one running or failed. The
 * split outlives the wizard ("Close and keep it running"), so the goal header
 * is where it stays visible and where the wizard is reopened from.
 */
function useActiveSplitJobs(goals: PlanningGoal[]): Map<string, TaskSplitJob> {
  const [jobs, setJobs] = useState<Map<string, TaskSplitJob>>(new Map())
  const goalKey = goals.map((goal) => `${goal.projectId}:${goal.id}`).join(',')

  useEffect(() => {
    let active = true
    const put = (job: TaskSplitJob) =>
      setJobs((current) => {
        const next = new Map(current)
        if (job.status === 'running' || job.status === 'failed') next.set(job.goalId, job)
        else next.delete(job.goalId)
        return next
      })
    void Promise.all(
      goals.map((goal) => window.ostlerAPI.getAITaskSplitJob(goal.projectId, goal.id))
    ).then((results) => {
      if (!active) return
      for (const result of results) if (result.ok && result.value) put(result.value)
    })
    const unsubscribe = window.ostlerAPI.onTaskSplitProgress((job) => {
      if (active) put(job)
    })
    return () => {
      active = false
      unsubscribe()
    }
    // goalKey stands in for goals: re-query only when the set of goals changes.
  }, [goalKey])

  return jobs
}

function splitBadgeLabel(job: TaskSplitJob): string {
  if (job.status === 'failed') return t('tasks:goalsMilestonesPanel.taskSplitFailedOpen')
  const done = job.phases.filter((phase) => phase.status === 'done').length
  return t('tasks:goalsMilestonesPanel.splittingIntoTasksPhases', {
    done,
    phaseCount: job.phases.length
  })
}

/**
 * Cached milestone advisories, keyed by milestone. Reviewing costs a model
 * call, so the last verdict is read back from disk and only refreshed on
 * request.
 */
function useMilestoneAdvisories(ws: PlanningWorkspace) {
  const [advisories, setAdvisories] = useState<Record<string, AIMilestoneAdvisory | null>>({})
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)

  const milestoneIds = ws.milestones.map((milestone) => milestone.id).join(',')
  useEffect(() => {
    if (!ws.projectId) return
    let cancelled = false
    void (async () => {
      const loaded: Record<string, AIMilestoneAdvisory | null> = {}
      for (const milestone of ws.milestones) {
        const result = await window.ostlerAPI.getAIMilestoneAdvisory(ws.projectId, milestone.id)
        loaded[milestone.id] = result.ok ? result.value : null
      }
      if (!cancelled) setAdvisories(loaded)
    })()
    return () => {
      cancelled = true
    }
    // milestoneIds stands in for the milestones: reload when the set changes.
  }, [ws.projectId, milestoneIds])

  const review = async (milestone: PlanningMilestone, selectedItemIds?: string[]) => {
    if (!ws.projectId) return
    setReviewingId(milestone.id)
    setReviewError(null)
    try {
      const result = await window.ostlerAPI.reviewAIMilestone(
        ws.projectId,
        milestone.id,
        selectedItemIds
      )
      if (!result.ok) throw new Error(result.error)
      setAdvisories((current) => ({ ...current, [milestone.id]: result.value }))
    } catch (error) {
      setReviewError(
        error instanceof Error
          ? error.message
          : t('tasks:goalsMilestonesPanel.couldntReviewMilestone')
      )
    } finally {
      setReviewingId(null)
    }
  }

  return { advisories, reviewingId, reviewError, setReviewError, review }
}

type Editing =
  { kind: 'goal'; record: PlanningGoal } | { kind: 'milestone'; record: PlanningMilestone }

// The service returns milestones by last-updated, so touching one moved it and
// the order looked random. Order by what needs attention instead.
const STATUS_RANK: Record<PlanningMilestoneStatus, number> = {
  active: 0,
  planned: 1,
  complete: 2,
  archived: 3
}

/**
 * The Milestones view: each goal as a section header with its milestones as
 * cards beneath it, and "No goal" last. Archived goals and milestones leave
 * the view for the Archived dialog.
 */
export function GoalsMilestonesPanel({ ws }: { ws: PlanningWorkspace }) {
  const features = useFeatures()
  const confirm = useConfirm()
  const { toast, toastUndo } = useToast()
  // Each milestone's costs (N6.3a), from the one money summary.
  const { summary: money } = useMoneySummary(ws.projectId)
  // How far each milestone has moved against a baseline (N7.4).
  const baselineText = useMilestoneBaseline(ws.projectId, ws.workItems, ws.milestones)
  const [editing, setEditing] = useState<Editing | null>(null)
  // Repeat this round (N5.7a): the milestone whose schedule is being set.
  const [repeating, setRepeating] = useState<PlanningMilestone | null>(null)
  const [comparing, setComparing] = useState<string | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  // Iterations (R6.1): the dialog's iteration (null for a new one), and the one finishing.
  const [iterationEditing, setIterationEditing] = useState<PlanningIteration | null | undefined>(
    undefined
  )
  const [finishing, setFinishing] = useState<PlanningIteration | null>(null)
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNotesSource | null>(null)
  const estimateUnit = useProjectEstimateUnit(ws.projectId)
  // `?edit=goal:<id>` or `?edit=milestone:<id>` (a search result, P5.7) opens its editor.
  const [params, setParams] = useOptionalSearchParams()
  const requestedEdit = params.get('edit')
  useEffect(() => {
    if (!requestedEdit) return
    const [kind, id] = requestedEdit.split(':')
    const goal = kind === 'goal' ? ws.goals.find((candidate) => candidate.id === id) : undefined
    const milestone =
      kind === 'milestone' ? ws.milestones.find((candidate) => candidate.id === id) : undefined
    if (!goal && !milestone && !ws.loaded) return
    if (goal) setEditing({ kind: 'goal', record: goal })
    if (milestone) setEditing({ kind: 'milestone', record: milestone })
    const next = new URLSearchParams(params)
    next.delete('edit')
    setParams(next, { replace: true })
    // Runs when the requested record can be found.
  }, [requestedEdit, ws.goals, ws.milestones, ws.loaded])
  const { advisories, reviewingId, reviewError, setReviewError, review } =
    useMilestoneAdvisories(ws)
  const today = toIsoDate(new Date())
  const goalCheckIns = useGoalCheckIns(ws.projectId)
  // Goals across projects (N5.6b): what each goal counts towards, and the one choosing.
  const countsTowards = useCountsTowards(ws.projectId)
  const [countingGoal, setCountingGoal] = useState<PlanningGoal | null>(null)
  const saveCountsTowards = async (
    goal: PlanningGoal,
    personalGoalId: string | null,
    title: string | null
  ): Promise<boolean> => {
    const before = countsTowards.countsTowards[goal.id] ?? null
    const result = await window.ostlerAPI.setGoalCountsTowards(goal.id, personalGoalId)
    if (!result.ok) {
      toast({ title: t('tasks:countsTowards.couldntSave'), body: result.error, tone: 'danger' })
      return false
    }
    await countsTowards.reload()
    const words =
      personalGoalId && title
        ? t('tasks:countsTowards.saved', { title: goal.title, goal: title })
        : before
          ? t('tasks:countsTowards.removed', { title: goal.title, goal: before.title })
          : null
    if (words)
      toastUndo(words, async () => {
        await window.ostlerAPI.setGoalCountsTowards(goal.id, result.value.previous)
        await countsTowards.reload()
      })
    return true
  }

  const goals = ws.goals.filter((goal) => goal.status !== 'archived')
  const archivedGoals = ws.goals.filter((goal) => goal.status === 'archived')
  const archivedMilestones = ws.milestones.filter((milestone) => milestone.status === 'archived')
  const splitJobs = useActiveSplitJobs(goals)
  const goalIds = new Set(goals.map((goal) => goal.id))
  const visibleMilestones = ws.milestones
    .filter((milestone) => milestone.status !== 'archived')
    .sort(
      (left, right) =>
        STATUS_RANK[left.status] - STATUS_RANK[right.status] || left.name.localeCompare(right.name)
    )
  const milestonesOf = (goalId: string | null) =>
    visibleMilestones.filter((milestone) =>
      goalId === null
        ? milestone.goalId === null || !goalIds.has(milestone.goalId)
        : milestone.goalId === goalId
    )
  const ungrouped = milestonesOf(null)

  // Archiving is reversible, so it happens at once. It hides the record from
  // this view, so the toast says where it went, and Undo puts it back.
  const archivedToast = (kind: 'goal' | 'milestone', name: string, undo: () => void) =>
    toastUndo(
      t('tasks:goalsMilestonesPanel.archived3', { kind, name }),
      undo,
      t('tasks:goalsMilestonesPanel.underArchivedWhereCan')
    )

  const changeGoalStatus = async (goal: PlanningGoal, status: PlanningGoalStatus) => {
    await ws.setGoalStatus(goal, status)
    if (status === 'archived' && goal.status !== 'archived') {
      archivedToast('goal', goal.title, () => void ws.setGoalStatus(goal, goal.status))
    }
  }

  const changeMilestoneStatus = async (
    milestone: PlanningMilestone,
    status: PlanningMilestoneStatus
  ) => {
    await ws.setMilestoneStatus(milestone, status)
    if (status === 'archived' && milestone.status !== 'archived') {
      archivedToast(
        'milestone',
        milestone.name,
        () => void ws.setMilestoneStatus(milestone, milestone.status)
      )
    }
  }

  const confirmDelete = (kind: 'goal' | 'milestone', name: string, contains: string) =>
    confirm({
      title: t('tasks:goalsMilestonesPanel.delete2', { kind, name }),
      body:
        kind === 'milestone'
          ? t('tasks:goalsMilestonesPanel.milestoneKeepsTasks')
          : t('tasks:goalsMilestonesPanel.cantUndoneNotDeleted', { contains, kind }),
      confirmLabel: t('tasks:goalsMilestonesPanel.delete3', { kind }),
      tone: 'danger'
    })

  const removeGoal = async (goal: PlanningGoal) => {
    if (!(await confirmDelete('goal', goal.title, 'milestones'))) return
    void ws.deleteGoal(goal)
  }

  const removeMilestone = async (milestone: PlanningMilestone) => {
    if (!(await confirmDelete('milestone', milestone.name, 'tasks'))) return
    void ws.deleteMilestone(milestone)
  }

  // Deleting an iteration is reversible: it happens at once, with Undo.
  const removeIteration = async (iteration: PlanningIteration) => {
    const deletion = await ws.deleteIteration(iteration)
    if (!deletion) return
    toastUndo(
      t('tasks:iterations.deleted', { name: iteration.name }),
      () => void ws.restoreIteration(deletion),
      deletion.taskIds.length > 0
        ? t('tasks:iterations.deletedBody', { count: deletion.taskIds.length })
        : undefined
    )
  }

  // Rounds (N5.7a): a new round brings a milestone and tasks, so the plan reloads.
  const startNextRound = async (milestone: PlanningMilestone) => {
    const result = await window.ostlerAPI.startNextMilestoneRound(milestone.id)
    if (!result.ok) {
      toast({ title: t('tasks:rounds.couldntStart'), body: result.error, tone: 'danger' })
      return
    }
    await ws.loadPlanning()
    toast({ title: t('tasks:rounds.started', { name: result.value.name }) })
  }

  // Stopping is reversible: it happens at once, and Undo turns the schedule back on.
  const stopRepeating = async (milestone: PlanningMilestone) => {
    const repeat = milestone.repeat
    const result = await window.ostlerAPI.setMilestoneRepeat(milestone.id, null)
    if (!result.ok) {
      toast({ title: t('tasks:rounds.couldntStop'), body: result.error, tone: 'danger' })
      return
    }
    await ws.loadPlanning()
    if (repeat)
      toastUndo(t('tasks:rounds.stopped', { name: milestone.name }), async () => {
        await window.ostlerAPI.setMilestoneRepeat(milestone.id, {
          rule: repeat.rule,
          lengthDays: repeat.lengthDays,
          nextStart: repeat.nextStart
        })
        await ws.loadPlanning()
      })
  }

  /** What a milestone's menu offers for rounds: only the latest round of a series repeats. */
  const roundActionsFor = (milestone: PlanningMilestone): RoundActions | undefined => {
    if (ws.milestones.some((candidate) => candidate.previousRoundId === milestone.id))
      return undefined
    const on = milestone.repeat?.on === true
    // Offered with no tasks yet too: a round copies the tasks it has when the next one starts.
    return {
      repeat: () => setRepeating(milestone),
      ...(on
        ? {
            startNow: () => void startNextRound(milestone),
            stop: () => void stopRepeating(milestone)
          }
        : {})
    }
  }

  const newMilestone = (goalId = '') => {
    ws.setMilestoneGoalId(goalId)
    ws.setCreateMode('milestone')
  }

  const milestoneCard = (milestone: PlanningMilestone) => (
    <MilestoneCard
      key={milestone.id}
      ws={ws}
      milestone={milestone}
      progress={milestoneProgress(milestone, ws.workItems, ws.projectedStatus, today)}
      advisory={advisories[milestone.id] ?? null}
      reviewing={reviewingId === milestone.id}
      reviewDisabled={reviewingId !== null && reviewingId !== milestone.id}
      onReview={(selectedItemIds) => void review(milestone, selectedItemIds)}
      onEdit={() => setEditing({ kind: 'milestone', record: milestone })}
      onStatusChange={(status) => void changeMilestoneStatus(milestone, status)}
      onDelete={() => void removeMilestone(milestone)}
      onWriteReleaseNotes={() => setReleaseNotes({ kind: 'milestone', milestone })}
      rounds={roundActionsFor(milestone)}
      costTotal={
        money?.byMilestone[milestone.id]
          ? formatMoney(money.byMilestone[milestone.id].total, money.currency)
          : undefined
      }
      baselineText={baselineText(milestone)}
    />
  )

  // A series of rounds (N5.7a) shows its latest round, with the earlier ones folded under it.
  const milestoneCards = (milestones: PlanningMilestone[]) => (
    <div className="milestones-view__grid">
      {groupRounds(milestones).map((series) =>
        series.earlier.length === 0 ? (
          milestoneCard(series.latest)
        ) : (
          <div
            key={series.latest.id}
            className="milestone-series"
            role="group"
            aria-label={t('tasks:rounds.series', { name: series.name })}
          >
            {milestoneCard(series.latest)}
            <details className="milestone-series__earlier">
              <summary>{t('tasks:rounds.earlierRounds', { count: series.earlier.length })}</summary>
              <div className="milestone-series">{series.earlier.map(milestoneCard)}</div>
            </details>
            <Button
              size="sm"
              variant="ghost"
              className="milestone-series__compare"
              aria-label={t('views:compareRounds.compareNamed', { name: series.name })}
              onClick={() => setComparing(series.latest.id)}
            >
              {t('views:compareRounds.compare')}
            </Button>
          </div>
        )
      )}
    </div>
  )

  const archivedCount = archivedGoals.length + archivedMilestones.length
  const empty = goals.length === 0 && visibleMilestones.length === 0

  return (
    <section
      className="milestones-view"
      aria-label={t('tasks:goalsMilestonesPanel.goalsMilestones')}
    >
      <header className="milestones-view__header">
        <p className="milestones-view__intro">
          {t('tasks:goalsMilestonesPanel.goalsOutcomesAfterMilestones')}
        </p>
        <div className="milestones-view__actions">
          {archivedCount > 0 && (
            <Button variant="ghost" icon={Archive} onClick={() => setArchiveOpen(true)}>
              {t('tasks:goalsMilestonesPanel.archived', { archivedCount })}
            </Button>
          )}
          <Button icon={IterationCw} onClick={() => setIterationEditing(null)}>
            {t('tasks:iterations.newIteration')}
          </Button>
          <Button icon={Plus} onClick={() => ws.setCreateMode('goal')}>
            {t('tasks:goalsMilestonesPanel.goal')}
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => newMilestone()}>
            {t('tasks:goalsMilestonesPanel.milestone')}
          </Button>
        </div>
      </header>

      {reviewError && (
        <InlineAlert tone="danger" onDismiss={() => setReviewError(null)}>
          {reviewError}
        </InlineAlert>
      )}

      <IterationsSection
        ws={ws}
        onEdit={(iteration) => setIterationEditing(iteration)}
        onFinish={setFinishing}
        onDelete={(iteration) => void removeIteration(iteration)}
        onWriteReleaseNotes={(iteration) => setReleaseNotes({ kind: 'iteration', iteration })}
      />

      {countingGoal && (
        <CountsTowardsDialog
          goal={countingGoal}
          current={countsTowards.countsTowards[countingGoal.id] ?? null}
          onClose={() => setCountingGoal(null)}
          onSave={(personalGoalId, title) => saveCountsTowards(countingGoal, personalGoalId, title)}
        />
      )}

      {releaseNotes && ws.projectId && (
        <ReleaseNotesDialog
          projectId={ws.projectId}
          source={releaseNotes}
          liveItems={ws.workItems}
          taskTypes={ws.taskTypes}
          onClose={() => setReleaseNotes(null)}
        />
      )}

      {empty && (
        <EmptyState
          icon={Target}
          title={t('tasks:goalsMilestonesPanel.noGoalsMilestonesYet')}
          description={t('tasks:goalsMilestonesPanel.startGoalOutcomeAfter')}
          action={
            <Button variant="primary" onClick={() => ws.setCreateMode('goal')}>
              {t('tasks:goalsMilestonesPanel.createGoal')}
            </Button>
          }
          secondaryAction={
            <Button variant="ghost" onClick={() => newMilestone()}>
              {t('tasks:goalsMilestonesPanel.createMilestone')}
            </Button>
          }
        />
      )}

      {goals.map((goal) => {
        const job = splitJobs.get(goal.id)
        const milestones = milestonesOf(goal.id)
        return (
          <section
            key={goal.id}
            className="milestones-view__group"
            aria-label={t('tasks:goalsMilestonesPanel.goal2', { goalTitle: goal.title })}
          >
            <header className="goal-header">
              <div className="goal-header__titles">
                <h2 className="goal-header__title">{goal.title}</h2>
                {goal.outcome && (
                  <p className="goal-header__outcome" title={goal.outcome}>
                    {goal.outcome}
                  </p>
                )}
                {countsTowards.countsTowards[goal.id] && (
                  <CountsTowardsLine link={countsTowards.countsTowards[goal.id]} />
                )}
              </div>
              <div className="goal-header__actions">
                {job && canPlanAndSplit(features) && (
                  <Button
                    size="sm"
                    variant={job.status === 'failed' ? 'danger' : 'ghost'}
                    title={t('tasks:goalsMilestonesPanel.reopenPlanTaskSplit')}
                    onClick={() => ws.openAgentPlanWizard(goal)}
                  >
                    {splitBadgeLabel(job)}
                  </Button>
                )}
                {features.ai && (
                  <Button
                    size="sm"
                    variant="ai"
                    loading={ws.isBusyOn(goal.id)}
                    disabled={ws.busy}
                    onClick={() => void ws.breakDownGoal(goal)}
                  >
                    {t('tasks:goalsMilestonesPanel.breakDownAi')}
                  </Button>
                )}
                {canPlanAndSplit(features) && (
                  <Button size="sm" disabled={ws.busy} onClick={() => ws.openAgentPlanWizard(goal)}>
                    {t('tasks:goalsMilestonesPanel.planSplit')}
                  </Button>
                )}
                <Select
                  label={t('tasks:goalsMilestonesPanel.goalStatus', { goalTitle: goal.title })}
                  hideLabel
                  size="sm"
                  value={goal.status}
                  disabled={ws.busy}
                  options={GOAL_STATUS_OPTIONS}
                  onChange={(event) =>
                    void changeGoalStatus(goal, event.target.value as PlanningGoalStatus)
                  }
                />
                <Menu
                  label={t('tasks:goalsMilestonesPanel.moreActions', { goalTitle: goal.title })}
                  placement="bottom-end"
                  items={[
                    {
                      label: t('tasks:goalsMilestonesPanel.addMilestone'),
                      icon: Plus,
                      onSelect: () => newMilestone(goal.id)
                    },
                    {
                      label: t('tasks:goalsMilestonesPanel.edit'),
                      icon: Pencil,
                      onSelect: () => setEditing({ kind: 'goal', record: goal })
                    },
                    {
                      label: t('tasks:countsTowards.menu'),
                      icon: Target,
                      onSelect: () => setCountingGoal(goal)
                    },
                    {
                      label: t('tasks:goalsMilestonesPanel.delete'),
                      icon: Trash2,
                      tone: 'danger',
                      onSelect: () => void removeGoal(goal)
                    }
                  ]}
                  renderTrigger={(trigger) => (
                    <IconButton
                      {...trigger}
                      label={t('tasks:goalsMilestonesPanel.moreActions', { goalTitle: goal.title })}
                      icon={Ellipsis}
                      size="sm"
                    />
                  )}
                />
              </div>
            </header>
            <GoalMeasureSection
              goal={goal}
              checkIns={goalCheckIns.checkIns[goal.id] ?? []}
              today={today}
              onChanged={goalCheckIns.reload}
              onGoalChanged={async () => {
                await ws.loadPlanning()
                await goalCheckIns.reload()
              }}
            />
            {milestones.length > 0 ? (
              milestoneCards(milestones)
            ) : (
              <p className="milestones-view__quiet">
                {t('tasks:goalsMilestonesPanel.noMilestonesGoalYet')}{' '}
                <Button size="sm" variant="ghost" icon={Plus} onClick={() => newMilestone(goal.id)}>
                  {t('tasks:goalsMilestonesPanel.addMilestone')}
                </Button>
              </p>
            )}
          </section>
        )
      })}

      {ungrouped.length > 0 && (
        <section
          className="milestones-view__group"
          aria-label={t('tasks:goalsMilestonesPanel.noGoal')}
        >
          <header className="goal-header">
            <div className="goal-header__titles">
              <h2 className="goal-header__title">{t('tasks:goalsMilestonesPanel.noGoal')}</h2>
              <p className="goal-header__outcome">
                {t('tasks:goalsMilestonesPanel.milestonesNotLinkedGoal', {
                  count: ungrouped.length
                })}
              </p>
            </div>
          </header>
          {milestoneCards(ungrouped)}
        </section>
      )}

      {!empty && visibleMilestones.length === 0 && (
        <EmptyState
          headingLevel={3}
          icon={Milestone}
          title={t('tasks:goalsMilestonesPanel.noMilestonesYet')}
          description={t('tasks:goalsMilestonesPanel.createMilestoneLinkTasks')}
          action={
            <Button onClick={() => newMilestone()}>
              {t('tasks:goalsMilestonesPanel.createMilestone')}
            </Button>
          }
        />
      )}

      {editing && (
        <RecordEditDialog
          editing={editing}
          busy={ws.busy}
          subprojects={ws.subprojects}
          onClose={() => setEditing(null)}
          onSave={(name, outcome, successCriteria, subprojectId) =>
            editing.kind === 'goal'
              ? ws.editGoalDetails(editing.record, { title: name, outcome })
              : ws.editMilestoneDetails(editing.record, {
                  name,
                  outcome,
                  successCriteria,
                  subprojectId
                })
          }
        />
      )}

      {comparing && ws.projectId && (
        <CompareRoundsDialog
          projectId={ws.projectId}
          milestoneId={comparing}
          onClose={() => setComparing(null)}
        />
      )}

      {repeating && (
        <RepeatRoundDialog
          milestone={repeating}
          tasks={ws.workItems.filter((item) => item.milestoneId === repeating.id)}
          onClose={() => setRepeating(null)}
          onSaved={() => void ws.loadPlanning()}
        />
      )}

      {iterationEditing !== undefined && (
        <IterationDialog
          iteration={iterationEditing}
          iterations={ws.iterations}
          busy={ws.busy}
          error={ws.error}
          onClose={() => {
            ws.setError(null)
            setIterationEditing(undefined)
          }}
          onSave={async (draft) => {
            const input = {
              name: draft.name.trim(),
              startDate: draft.startDate,
              endDate: draft.endDate,
              goal: draft.goal.trim()
            }
            const saved = iterationEditing
              ? await ws.updateIteration(iterationEditing, input)
              : await ws.createIteration(input)
            return saved !== null
          }}
        />
      )}

      {finishing && (
        <FinishIterationDialog
          iteration={finishing}
          iterations={ws.iterations}
          tasks={ws.workItems}
          unit={estimateUnit}
          busy={ws.busy}
          error={ws.error}
          onClose={() => {
            ws.setError(null)
            setFinishing(null)
          }}
          onFinish={async (carryOver) => (await ws.finishIteration(finishing, carryOver)) !== null}
        />
      )}

      <ArchivedDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        ws={ws}
        goals={archivedGoals}
        milestones={archivedMilestones}
        onDeleteGoal={removeGoal}
        onDeleteMilestone={removeMilestone}
      />
    </section>
  )
}

/** Edit a goal's title or a milestone's name, and its outcome. */
function RecordEditDialog({
  editing,
  busy,
  subprojects,
  onClose,
  onSave
}: {
  editing: Editing
  busy: boolean
  subprojects: readonly PlanningSubproject[] | undefined
  onClose: () => void
  /** `subprojectId` is undefined when the workstream was not changed. */
  onSave: (
    name: string,
    outcome: string,
    successCriteria: string[],
    subprojectId: string | null | undefined
  ) => Promise<boolean>
}) {
  const isGoal = editing.kind === 'goal'
  const [name, setName] = useState(
    editing.kind === 'goal' ? editing.record.title : editing.record.name
  )
  const [outcome, setOutcome] = useState(editing.record.outcome ?? '')
  const [criteria, setCriteria] = useState<string[]>(
    editing.kind === 'milestone' ? editing.record.successCriteria : []
  )
  const savedSubproject = editing.kind === 'milestone' ? (editing.record.subprojectId ?? '') : ''
  const [subprojectId, setSubprojectId] = useState(savedSubproject)
  const formId = `edit-${editing.kind}-${editing.record.id}`

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      closeOnBackdrop={false}
      title={
        isGoal
          ? t('tasks:goalsMilestonesPanel.editGoal')
          : t('tasks:goalsMilestonesPanel.editMilestone')
      }
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('tasks:goalsMilestonesPanel.cancel')}
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={busy}>
            {isGoal
              ? t('tasks:goalsMilestonesPanel.saveGoal')
              : t('tasks:goalsMilestonesPanel.saveMilestone')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault()
          const moved = subprojectId === savedSubproject ? undefined : subprojectId || null
          void onSave(name, outcome, criteria, moved).then((saved) => {
            if (saved) onClose()
          })
        }}
      >
        <TextField
          label={
            isGoal
              ? t('tasks:goalsMilestonesPanel.goalTitle')
              : t('tasks:goalsMilestonesPanel.milestoneName')
          }
          data-autofocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <TextArea
          label={t('tasks:goalsMilestonesPanel.outcome')}
          rows={3}
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
        />
        {!isGoal && (
          <SubprojectField
            size="md"
            subprojects={subprojects}
            value={subprojectId}
            onChange={setSubprojectId}
          />
        )}
        {!isGoal && <SuccessCriteriaEditor items={criteria} onChange={setCriteria} />}
      </form>
      {!isGoal && <LinkedFrom kind="milestone" id={editing.record.id} onOpen={onClose} />}
    </Dialog>
  )
}

/** Archived goals and milestones: out of the view, restorable or deletable. */
function ArchivedDialog({
  open,
  onClose,
  ws,
  goals,
  milestones,
  onDeleteGoal,
  onDeleteMilestone
}: {
  open: boolean
  onClose: () => void
  ws: PlanningWorkspace
  goals: PlanningGoal[]
  milestones: PlanningMilestone[]
  onDeleteGoal: (goal: PlanningGoal) => Promise<void>
  onDeleteMilestone: (milestone: PlanningMilestone) => Promise<void>
}) {
  const { toastUndo } = useToast()
  const restoreGoal = async (goal: PlanningGoal) => {
    await ws.setGoalStatus(goal, 'active')
    toastUndo(
      t('tasks:goalsMilestonesPanel.restoredGoal', { goalTitle: goal.title }),
      () => void ws.setGoalStatus(goal, 'archived')
    )
  }
  const restoreMilestone = async (milestone: PlanningMilestone) => {
    await ws.setMilestoneStatus(milestone, 'planned')
    toastUndo(
      t('tasks:goalsMilestonesPanel.restoredMilestone', { milestoneName: milestone.name }),
      () => void ws.setMilestoneStatus(milestone, 'archived')
    )
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title={t('tasks:goalsMilestonesPanel.archivedGoalsMilestones')}
      description={t('tasks:goalsMilestonesPanel.restoreOneBringBack')}
      footer={<Button onClick={onClose}>{t('tasks:goalsMilestonesPanel.close')}</Button>}
    >
      <div className="archived-records">
        <h3>{t('tasks:goalsMilestonesPanel.goals')}</h3>
        {goals.length === 0 ? (
          <p className="milestones-view__quiet">
            {t('tasks:goalsMilestonesPanel.noArchivedGoals')}
          </p>
        ) : (
          <ul>
            {goals.map((goal) => (
              <li key={goal.id}>
                <span title={goal.outcome || goal.title}>{goal.title}</span>
                <Button size="sm" disabled={ws.busy} onClick={() => void restoreGoal(goal)}>
                  {t('tasks:goalsMilestonesPanel.restore')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={ws.busy}
                  onClick={() => void onDeleteGoal(goal)}
                >
                  {t('tasks:goalsMilestonesPanel.delete')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <h3>{t('tasks:goalsMilestonesPanel.milestones')}</h3>
        {milestones.length === 0 ? (
          <p className="milestones-view__quiet">
            {t('tasks:goalsMilestonesPanel.noArchivedMilestones')}
          </p>
        ) : (
          <ul>
            {milestones.map((milestone) => (
              <li key={milestone.id}>
                <span title={milestone.outcome || milestone.name}>{milestone.name}</span>
                <Button
                  size="sm"
                  disabled={ws.busy}
                  onClick={() => void restoreMilestone(milestone)}
                >
                  {t('tasks:goalsMilestonesPanel.restore')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={ws.busy}
                  onClick={() => void onDeleteMilestone(milestone)}
                >
                  {t('tasks:goalsMilestonesPanel.delete')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
