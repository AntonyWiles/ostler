import { Suspense, lazy, useEffect, useId, useMemo, useState, type ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { planProgress, type PlanProgress, type PlanStep } from '@shared/planning/plan-steps'
import { useOptionalSearchParams } from '../../hooks/useOptionalSearchParams'
import { NEW_WHITEBOARD_PARAM, WHITEBOARD_PARAM, whiteboardPath } from '../../navigation/paths'
import type { ProjectViewProps } from '../../navigation/view-props'
import { Icon, Spinner } from '../../ui'
import { Check, Circle, Presentation } from '../../ui/icons'
import type { PlanStepProps } from './plan/plan-step-props'
import { PlanGoalStep } from './plan/PlanGoalStep'
import { PlanMilestonesStep } from './plan/PlanMilestonesStep'
import { PlanTasksStep } from './plan/PlanTasksStep'
import { PlanScheduleStep } from './plan/PlanScheduleStep'
import { PlanPeopleStep } from './plan/PlanPeopleStep'
import { PlanStartStep } from './plan/PlanStartStep'
import { usePlanPeople } from './plan/usePlanPeople'
import { PlanWhiteboards, usePlanWhiteboards } from './plan/PlanWhiteboards'
import { rememberWhiteboard, rememberedWhiteboard } from './plan/open-whiteboards'
import './plan/PlanTab.css'
import { t } from '@shared/i18n'

const STEP_PANES: Record<PlanStep, ComponentType<PlanStepProps>> = {
  goal: PlanGoalStep,
  milestones: PlanMilestonesStep,
  tasks: PlanTasksStep,
  schedule: PlanScheduleStep,
  people: PlanPeopleStep,
  start: PlanStartStep
}

/** D28: the editor's code loads only when a whiteboard opens. */
const PlanWhiteboard = lazy(() => import('./plan/PlanWhiteboard'))

/** The Whiteboards entry under the steps: not a step, never counted by `planProgress`. */
const WHITEBOARDS = 'whiteboards'
type PlanPane = PlanStep | typeof WHITEBOARDS

/**
 * The project's Plan: its steps in a list beside the selected step's pane.
 * The Done / To do marks come from `planProgress` and are advice only; any
 * step can be opened at any time.
 */
export function PlanTab({ project, ws, features, suggestTasks }: ProjectViewProps) {
  const planPeople = usePlanPeople(project, ws)
  const overCapacityCount = planPeople.show ? planPeople.overWeeks.length : null
  const progress = useMemo(
    () =>
      planProgress({
        goals: ws.goals,
        milestones: ws.milestones,
        workItems: ws.workItems,
        people: overCapacityCount === null ? null : { overCapacityCount }
      }),
    [ws.goals, ws.milestones, ws.workItems, overCapacityCount]
  )

  if (!ws.loaded && !ws.error) {
    return (
      <div className="ostler-workspace-loading">
        <Spinner label={t('navigation:projectWorkspace.loading')} />
      </div>
    )
  }

  return (
    <PlanPage
      project={project}
      ws={ws}
      features={features}
      suggestTasks={suggestTasks}
      progress={progress}
      people={planPeople.show ? planPeople : null}
    />
  )
}

/**
 * Mounts once loaded, so the page opens on the first open step and then stays where it is put.
 * `?whiteboard=<id>` opens that whiteboard over the whole page (D4); it stays open when the
 * parameter goes (the task drawer's route drops it), and when the Plan is left for another
 * view and opened again, until Back to the plan.
 * `?newWhiteboard=1` shows the Whiteboards pane with its New whiteboard dialog open; Create
 * replaces the parameter with `?whiteboard=<new id>` and Cancel removes it: every way of making
 * a whiteboard goes through that one dialog.
 */
function PlanPage(props: PlanStepProps) {
  const { progress, project } = props
  const headingId = useId()
  const navigate = useNavigate()
  const [params, setParams] = useOptionalSearchParams()
  const asked = params.get(WHITEBOARD_PARAM)
  const askedNew = params.get(NEW_WHITEBOARD_PARAM) === '1'
  const remembered = rememberedWhiteboard(project.id)
  const [chosen, setChosen] = useState<PlanPane>(() =>
    askedNew || remembered !== null ? WHITEBOARDS : progress.firstOpenStep
  )
  const [seenNew, setSeenNew] = useState(askedNew)
  if (askedNew !== seenNew) {
    setSeenNew(askedNew)
    if (askedNew) setChosen(WHITEBOARDS)
  }
  const [openBoard, setOpenBoard] = useState<string | null>(asked ?? (askedNew ? null : remembered))
  useEffect(() => {
    rememberWhiteboard(project.id, openBoard)
  }, [openBoard, project.id])
  const [seen, setSeen] = useState<string | null>(asked)
  if (asked !== seen) {
    setSeen(asked)
    if (asked) setOpenBoard(asked)
  }
  const whiteboards = usePlanWhiteboards(project.id)
  /** The board Back to the plan closed: its Open button takes focus (D14). */
  const [closedBoard, setClosedBoard] = useState<string | null>(null)

  const openWhiteboard = (whiteboardId: string, options?: { replace?: boolean }) => {
    setOpenBoard(whiteboardId)
    navigate(whiteboardPath(project.id, whiteboardId), options)
  }
  /** `?newWhiteboard=1` is used up: the new board replaces it, or it goes on Cancel. */
  const newWhiteboardDone = (whiteboardId: string | null) => {
    if (whiteboardId) {
      openWhiteboard(whiteboardId, { replace: true })
      return
    }
    setParams(
      (before) => {
        const next = new URLSearchParams(before)
        next.delete(NEW_WHITEBOARD_PARAM)
        return next
      },
      { replace: true }
    )
  }
  const backToPlan = () => {
    setClosedBoard(openBoard)
    setOpenBoard(null)
    setChosen(WHITEBOARDS)
    setParams(
      (before) => {
        const next = new URLSearchParams(before)
        next.delete(WHITEBOARD_PARAM)
        return next
      },
      { replace: true }
    )
  }

  if (openBoard !== null) {
    return (
      <div className="plan-page plan-page--board">
        <Suspense
          fallback={
            <div className="plan-board plan-board--message">
              <Spinner label={t('views:planView.whiteboards.opening')} />
            </div>
          }
        >
          <PlanWhiteboard
            key={openBoard}
            projectId={project.id}
            whiteboardId={openBoard}
            milestones={props.ws.milestones}
            onBack={backToPlan}
          />
        </Suspense>
      </div>
    )
  }

  const pane: PlanPane =
    chosen === WHITEBOARDS || progress.steps.includes(chosen) ? chosen : 'start'
  const Pane = pane === WHITEBOARDS ? null : STEP_PANES[pane]
  const paneName =
    pane === WHITEBOARDS
      ? t('views:planView.whiteboards.name')
      : t(`views:planView.step.${pane}.name`)
  const paneDescription =
    pane === WHITEBOARDS
      ? t('views:planView.whiteboards.description')
      : t(`views:planView.step.${pane}.description`)

  return (
    <div className="plan-page">
      <div className="plan-page__side">
        <nav aria-label={t('views:planView.stepsLabel')}>
          <ol className="plan-page__steps">
            {progress.steps.map((item) => {
              const done = progress.done[item]
              const summary = stepSummary(item, progress)
              return (
                <li key={item}>
                  <button
                    type="button"
                    className="plan-page__step"
                    aria-current={item === pane ? 'step' : undefined}
                    onClick={() => setChosen(item)}
                  >
                    <span className="plan-page__step-name">
                      {t(`views:planView.step.${item}.name`)}
                    </span>
                    <span className="plan-page__step-mark" data-done={done}>
                      <Icon icon={done ? Check : Circle} />
                      {done ? t('views:planView.done') : t('views:planView.toDo')}
                    </span>
                    {summary && <span className="plan-page__step-summary">{summary}</span>}
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>
        <ul className="plan-page__steps plan-page__extras">
          <li>
            <button
              type="button"
              className="plan-page__step"
              aria-current={pane === WHITEBOARDS ? 'true' : undefined}
              onClick={() => setChosen(WHITEBOARDS)}
            >
              <span className="plan-page__step-name">{t('views:planView.whiteboards.name')}</span>
              <span className="plan-page__step-mark">
                <Icon icon={Presentation} />
              </span>
              {whiteboards.loaded && !whiteboards.error && (
                <span className="plan-page__step-summary">
                  {t('views:planView.whiteboards.count', { count: whiteboards.items.length })}
                </span>
              )}
            </button>
          </li>
        </ul>
      </div>
      <section aria-labelledby={headingId} className="plan-page__pane">
        <div className="plan-page__pane-head">
          <h2 id={headingId}>{paneName}</h2>
          <p>{paneDescription}</p>
        </div>
        {Pane ? (
          <Pane {...props} />
        ) : (
          <PlanWhiteboards
            projectId={project.id}
            projectName={project.name}
            list={whiteboards}
            onOpen={openWhiteboard}
            askNew={askedNew}
            onAskNewDone={newWhiteboardDone}
            returnFocusTo={closedBoard}
          />
        )}
      </section>
    </div>
  )
}

/** The one line under a step's name in the list; null when it has nothing to say. */
function stepSummary(step: PlanStep, progress: PlanProgress): string | null {
  switch (step) {
    case 'goal':
      return t('views:planView.summary.goals', { count: progress.goalCount })
    case 'milestones':
      return t('views:planView.summary.milestones', { count: progress.milestoneCount })
    case 'tasks':
      return t('views:planView.summary.tasks', { count: progress.taskCount })
    case 'schedule':
      if (progress.scheduleIssueCount > 0)
        return t('views:planView.summary.toFix', { count: progress.scheduleIssueCount })
      return progress.taskCount > 0 ? t('views:planView.summary.scheduled') : null
    case 'people':
      return progress.overCapacityCount > 0
        ? t('views:planView.summary.overCapacity', { count: progress.overCapacityCount })
        : t('views:planView.summary.noOverload')
    case 'start': {
      if (progress.done.start) return t('views:planView.summary.ready')
      const count = progress.steps.filter((s) => s !== 'start' && !progress.done[s]).length
      return t('views:planView.summary.stepsToGo', { count })
    }
  }
}
