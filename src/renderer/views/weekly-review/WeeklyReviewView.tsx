import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  HomeTask,
  Result,
  WeeklyReview,
  WeeklyReviewMilestone,
  WeeklyReviewStepId,
  WeeklyReviewTask
} from '@shared/ostler-api'
import { WEEKLY_REVIEW_STEPS } from '@shared/ostler-api'
import { formatIsoDate, formatIsoDateShort } from '@shared/dates'
import { daysWaited } from '@shared/planning/weekly-review'
import { t } from '@shared/i18n'
import { useHomeFeed } from '../../hooks/useHomeFeed'
import { useToday } from '../../hooks/useToday'
import { homePath, inboxPath, projectPath, taskPath } from '../../navigation/paths'
import { Button, InlineAlert, PageHeader, Skeleton, useToast } from '../../ui'
import { relativeTimeText } from '../../ui/date-text'
import { ArrowLeft, ArrowRight, CalendarClock, Check, SkipForward } from '../../ui/icons'
import { RescheduleDialog } from '../../components/reschedule/RescheduleDialog'
import { ProjectMark } from '../../components/ProjectMark'
import { useOstler } from '../../context/OstlerContext'
import {
  allDismissed,
  clearProgress,
  readProgress,
  reviewCounts,
  stepIds,
  writeProgress,
  type ReviewProgress
} from './review-progress'
import './WeeklyReviewView.css'

const STEP_TITLE: Record<WeeklyReviewStepId, string> = {
  inbox: 'views:weeklyReview.step.inbox',
  overdue: 'views:weeklyReview.step.overdue',
  blocked: 'views:weeklyReview.step.blocked',
  stale: 'views:weeklyReview.step.stale',
  someday: 'views:weeklyReview.step.someday',
  upcoming: 'views:weeklyReview.step.upcoming',
  milestones: 'views:weeklyReview.step.milestones'
}

const STEP_DESCRIPTION: Record<WeeklyReviewStepId, string> = {
  inbox: 'views:weeklyReview.describe.inbox',
  overdue: 'views:weeklyReview.describe.overdue',
  blocked: 'views:weeklyReview.describe.blocked',
  stale: 'views:weeklyReview.describe.stale',
  someday: 'views:weeklyReview.describe.someday',
  upcoming: 'views:weeklyReview.describe.upcoming',
  milestones: 'views:weeklyReview.describe.milestones'
}

/** How many things a step has now, for its title. */
function stepCount(review: WeeklyReview, step: WeeklyReviewStepId, dismissed: Set<string>) {
  if (step === 'inbox') return review.inboxCount
  return stepIds(review, step).filter((id) => !dismissed.has(id)).length
}

/**
 * Weekly review (N1.5, N13): one step at a time across every enabled
 * project, with Next, Back and Skip. Each item's action is one click and
 * offers undo. Where the person is stays in local storage, so they can
 * leave and come back to the same step; Finish review records the counts.
 */
export function WeeklyReviewView() {
  const navigate = useNavigate()
  const today = useToday()
  const { toast, toastUndo } = useToast()
  const feed = useHomeFeed(() => window.ostlerAPI.getWeeklyReview(today), [today], 'weekly-review')
  const [progress, setProgressState] = useState<ReviewProgress>(() => readProgress())
  const [rescheduling, setRescheduling] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const review = feed.value
  const step = WEEKLY_REVIEW_STEPS[progress.step]
  const dismissed = allDismissed(progress)

  const setProgress = (change: (current: ReviewProgress) => ReviewProgress) =>
    setProgressState((current) => {
      const next = change(current)
      writeProgress(next)
      return next
    })

  // A step's counts start from what it showed when it was first opened.
  useEffect(() => {
    if (!review) return
    if (step === 'inbox') {
      if (progress.inboxShown === null)
        setProgress((current) => ({ ...current, inboxShown: review.inboxCount }))
    } else if (!progress.shown[step]) {
      const ids = stepIds(review, step)
      setProgress((current) => ({ ...current, shown: { ...current.shown, [step]: ids } }))
    }
  }, [review, step])

  const go = (index: number, skip = false) =>
    setProgress((current) => ({
      ...current,
      step: index,
      skipped: skip
        ? [...new Set([...current.skipped, step])]
        : current.skipped.filter((id) => id !== step)
    }))

  /** Runs a task change; its toast undoes it. */
  const act = async (
    call: () => Promise<Result<unknown>>,
    done: string,
    undo: () => Promise<Result<unknown>>
  ) => {
    const result = await call()
    if (!result.ok) {
      toast({ title: t('views:weeklyReview.couldntChange'), body: result.error, tone: 'danger' })
      return
    }
    void feed.reload()
    toastUndo(done, async () => {
      const back = await undo()
      if (!back.ok)
        toast({ title: t('views:weeklyReview.couldntUndo'), body: back.error, tone: 'danger' })
      void feed.reload()
    })
  }

  const someday = (task: HomeTask, value: boolean) =>
    act(
      () => window.ostlerAPI.updatePlanningWorkItem(task.id, { someday: value }),
      t(value ? 'tasks:someday.moved' : 'tasks:someday.broughtBack', { title: task.title }),
      () => window.ostlerAPI.updatePlanningWorkItem(task.id, { someday: !value })
    )

  const wontDo = (task: HomeTask) =>
    act(
      () => window.ostlerAPI.closePlanningWorkItemAsWontDo(task.id, {}),
      t('tasks:wontDo.closed', { title: task.title }),
      () => window.ostlerAPI.unarchivePlanningWorkItem(task.id)
    )

  /** Still on and Keep: leaves it off this review only. */
  const leaveOff = (task: HomeTask, words: string) => {
    // The step it was left off in: not a change there, wherever else it changed.
    const at = step
    setProgress((current) => ({
      ...current,
      dismissed: { ...current.dismissed, [at]: [...(current.dismissed[at] ?? []), task.id] }
    }))
    toastUndo(words, () =>
      setProgress((current) => ({
        ...current,
        dismissed: {
          ...current.dismissed,
          [at]: (current.dismissed[at] ?? []).filter((id) => id !== task.id)
        }
      }))
    )
  }

  const finish = async () => {
    if (!review) return
    setFinishing(true)
    const result = await window.ostlerAPI.finishWeeklyReview(reviewCounts(progress, review))
    setFinishing(false)
    if (!result.ok) {
      toast({ title: t('views:weeklyReview.couldntFinish'), body: result.error, tone: 'danger' })
      return
    }
    clearProgress()
    toast({ title: t('views:weeklyReview.finished'), tone: 'success' })
    navigate(homePath())
  }

  const open = (task: HomeTask) => navigate(taskPath(task.projectId, task.id))
  const openMilestone = (milestone: WeeklyReviewMilestone) =>
    navigate(projectPath(milestone.projectId, 'milestones'))

  const last = progress.step === WEEKLY_REVIEW_STEPS.length - 1
  const count = review ? stepCount(review, step, dismissed) : null

  return (
    <div className="ostler-weekly-review">
      <PageHeader
        title={t('navigation:globalViews.weeklyReview.label')}
        subtitle={t('views:weeklyReview.stepOf', {
          step: progress.step + 1,
          total: WEEKLY_REVIEW_STEPS.length
        })}
      />
      <ol className="ostler-weekly-review-steps" aria-label={t('views:weeklyReview.steps')}>
        {WEEKLY_REVIEW_STEPS.map((id, index) => (
          <li
            key={id}
            aria-current={index === progress.step ? 'step' : undefined}
            data-skipped={progress.skipped.includes(id) || undefined}
          >
            {t(STEP_TITLE[id])}
          </li>
        ))}
      </ol>

      <section className="ostler-weekly-review-step" aria-labelledby="weekly-review-step-title">
        <h2 id="weekly-review-step-title">
          {count === null
            ? t(STEP_TITLE[step])
            : t('views:weeklyReview.titleWithCount', { title: t(STEP_TITLE[step]), count })}
        </h2>
        <p className="ostler-weekly-review-describe">{t(STEP_DESCRIPTION[step])}</p>
        {feed.error && <InlineAlert tone="danger">{feed.error}</InlineAlert>}
        {!review ? (
          <Skeleton lines={4} />
        ) : (
          <StepBody
            step={step}
            review={review}
            dismissed={dismissed}
            today={today}
            actions={{
              open,
              openMilestone,
              someday,
              wontDo,
              leaveOff,
              openInbox: () => navigate(inboxPath()),
              reschedule: () => setRescheduling(true)
            }}
          />
        )}
      </section>

      <footer className="ostler-weekly-review-footer">
        <Button
          icon={ArrowLeft}
          disabled={progress.step === 0}
          onClick={() => go(progress.step - 1)}
        >
          {t('views:weeklyReview.back')}
        </Button>
        <div className="ostler-weekly-review-forward">
          {!last && (
            <Button icon={SkipForward} onClick={() => go(progress.step + 1, true)}>
              {t('views:weeklyReview.skip')}
            </Button>
          )}
          {last ? (
            <Button
              variant="primary"
              icon={Check}
              disabled={!review || finishing}
              onClick={() => void finish()}
            >
              {t('views:weeklyReview.finish')}
            </Button>
          ) : (
            <Button variant="primary" icon={ArrowRight} onClick={() => go(progress.step + 1)}>
              {t('views:weeklyReview.next')}
            </Button>
          )}
        </div>
      </footer>

      <RescheduleDialog
        open={rescheduling}
        onClose={() => setRescheduling(false)}
        workItemIds={review?.overdue.map((task) => task.id)}
        onChanged={() => void feed.reload()}
      />
    </div>
  )
}

interface StepActions {
  open(task: HomeTask): void
  openMilestone(milestone: WeeklyReviewMilestone): void
  someday(task: HomeTask, value: boolean): void
  wontDo(task: HomeTask): void
  leaveOff(task: HomeTask, words: string): void
  openInbox(): void
  reschedule(): void
}

function StepBody({
  step,
  review,
  dismissed,
  today,
  actions
}: {
  step: WeeklyReviewStepId
  review: WeeklyReview
  dismissed: Set<string>
  today: string
  actions: StepActions
}) {
  const now = Date.now()
  const tasks = (list: WeeklyReviewTask[]) => list.filter((task) => !dismissed.has(task.id))
  const nothing = (
    <p className="ostler-weekly-review-empty">{t('views:weeklyReview.nothingHere')}</p>
  )
  const openButton = (task: HomeTask) => (
    <Button size="sm" onClick={() => actions.open(task)}>
      {t('views:weeklyReview.open')}
    </Button>
  )
  const somedayButton = (task: HomeTask) => (
    <Button size="sm" onClick={() => actions.someday(task, true)}>
      {t('views:weeklyReview.someday')}
    </Button>
  )
  const wontDoButton = (task: HomeTask) => (
    <Button size="sm" onClick={() => actions.wontDo(task)}>
      {t('tasks:wontDo.mark')}
    </Button>
  )

  switch (step) {
    case 'inbox':
      return (
        <div className="ostler-weekly-review-inbox">
          <p>
            {review.inboxCount === 0
              ? t('views:weeklyReview.nothingHere')
              : t('views:weeklyReview.inboxWaiting', { count: review.inboxCount })}
          </p>
          <Button onClick={actions.openInbox}>{t('views:weeklyReview.openInbox')}</Button>
        </div>
      )
    case 'overdue': {
      const list = tasks(review.overdue)
      if (list.length === 0) return nothing
      return (
        <>
          <div className="ostler-weekly-review-step-actions">
            <Button size="sm" icon={CalendarClock} onClick={actions.reschedule}>
              {t('views:reschedule.open')}
            </Button>
          </div>
          <TaskList
            tasks={list}
            meta={(task) =>
              t('views:weeklyReview.due', { date: formatIsoDateShort(task.targetDate!) })
            }
            actions={(task) => (
              <>
                {openButton(task)}
                {somedayButton(task)}
                {wontDoButton(task)}
              </>
            )}
          />
        </>
      )
    }
    case 'blocked': {
      const list = tasks(review.blocked)
      if (list.length === 0) return nothing
      return (
        <TaskList
          tasks={list}
          meta={(task) => t('views:weeklyReview.waited', { count: daysWaited(task.since, now) })}
          actions={(task) => (
            <>
              {openButton(task)}
              {wontDoButton(task)}
            </>
          )}
        />
      )
    }
    case 'stale': {
      const list = tasks(review.stale)
      if (list.length === 0) return nothing
      return (
        <TaskList
          tasks={list}
          meta={(task) =>
            t('views:weeklyReview.updated', { when: relativeTimeText(task.since, now) })
          }
          actions={(task) => (
            <>
              {openButton(task)}
              {somedayButton(task)}
              {wontDoButton(task)}
              <Button
                size="sm"
                onClick={() =>
                  actions.leaveOff(task, t('views:weeklyReview.stillOnDone', { title: task.title }))
                }
              >
                {t('views:weeklyReview.stillOn')}
              </Button>
            </>
          )}
        />
      )
    }
    case 'someday': {
      const list = tasks(review.someday)
      if (list.length === 0) return nothing
      return (
        <TaskList
          tasks={list}
          meta={(task) => t('views:weeklyReview.made', { when: relativeTimeText(task.since, now) })}
          actions={(task) => (
            <>
              <Button size="sm" onClick={() => actions.someday(task, false)}>
                {t('tasks:someday.bringBack')}
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  actions.leaveOff(task, t('views:weeklyReview.keptDone', { title: task.title }))
                }
              >
                {t('views:weeklyReview.keep')}
              </Button>
              {wontDoButton(task)}
            </>
          )}
        />
      )
    }
    case 'upcoming':
      if (review.upcoming.length === 0) return nothing
      return (
        <div className="ostler-weekly-review-days">
          {review.upcoming.map((day) => (
            <section key={day.date} aria-label={dayName(day.date, today)}>
              <h3>{dayName(day.date, today)}</h3>
              <ul className="ostler-weekly-review-list">
                {day.milestones.map((milestone) => (
                  <MilestoneRow
                    key={milestone.milestoneId}
                    milestone={milestone}
                    onOpen={actions.openMilestone}
                  />
                ))}
                {day.tasks.map((task) => (
                  <Row key={task.id} task={task} meta={null} actions={openButton(task)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )
    case 'milestones':
      if (review.milestones.length === 0) return nothing
      return (
        <ul className="ostler-weekly-review-list">
          {review.milestones.map((milestone) => (
            <MilestoneRow
              key={milestone.milestoneId}
              milestone={milestone}
              onOpen={actions.openMilestone}
            />
          ))}
        </ul>
      )
  }
}

function dayName(date: string, today: string): string {
  if (date === today) return t('views:weeklyReview.today')
  return formatIsoDate(date, { weekday: 'long', day: 'numeric', month: 'long' })
}

/** The project's colour and icon (N5.1), as the Inbox shows it. */
function Mark({ projectId, color }: { projectId: string; color: string }) {
  const { projects } = useOstler()
  const project = projects.find((entry) => entry.id === projectId) ?? { color }
  return <ProjectMark project={project} className="ostler-weekly-review-mark" />
}

function TaskList({
  tasks,
  meta,
  actions
}: {
  tasks: WeeklyReviewTask[]
  meta: (task: WeeklyReviewTask) => string
  actions: (task: WeeklyReviewTask) => ReactNode
}) {
  return (
    <ul className="ostler-weekly-review-list">
      {tasks.map((task) => (
        <Row key={task.id} task={task} meta={meta(task)} actions={actions(task)} />
      ))}
    </ul>
  )
}

function Row({ task, meta, actions }: { task: HomeTask; meta: string | null; actions: ReactNode }) {
  return (
    <li className="ostler-weekly-review-row">
      <Mark projectId={task.projectId} color={task.projectColor} />
      <span className="ostler-weekly-review-text">
        <span className="ostler-weekly-review-title">{task.title}</span>
        <span className="ostler-weekly-review-meta">
          {meta ? `${task.projectName} · ${meta}` : task.projectName}
        </span>
      </span>
      <span
        className="ostler-weekly-review-actions"
        role="group"
        aria-label={t('views:weeklyReview.actionsFor', { title: task.title })}
      >
        {actions}
      </span>
    </li>
  )
}

function MilestoneRow({
  milestone,
  onOpen
}: {
  milestone: WeeklyReviewMilestone
  onOpen: (milestone: WeeklyReviewMilestone) => void
}) {
  const meta = [milestone.projectName, milestone.reason].filter(Boolean).join(' · ')
  return (
    <li className="ostler-weekly-review-row">
      <Mark projectId={milestone.projectId} color={milestone.projectColor} />
      <span className="ostler-weekly-review-text">
        <span className="ostler-weekly-review-title">
          {t('views:weeklyReview.milestone', { name: milestone.name })}
        </span>
        <span className="ostler-weekly-review-meta">{meta}</span>
      </span>
      <span className="ostler-weekly-review-actions">
        <Button
          size="sm"
          aria-label={t('views:weeklyReview.openMilestone', { name: milestone.name })}
          onClick={() => onOpen(milestone)}
        >
          {t('views:weeklyReview.open')}
        </Button>
      </span>
    </li>
  )
}
