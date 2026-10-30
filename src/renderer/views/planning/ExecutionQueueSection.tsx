import { useEffect, useRef, useState } from 'react'
import {
  HarnessProjectState,
  HarnessSession,
  HarnessTask,
  PlanningMilestone,
  PlanningPriority,
  PlanningWorkItem,
  ProjectAutoDispatchConfig
} from '@shared/ostler-api'
import { useSearchFilter } from '../../hooks/useSearchFilter'
import {
  AGENT_RUN_FILTERS,
  agentRunFilterLabel,
  type AgentRunFilter
} from '../project-detail/types'
import { agentRunState, type AgentRunState } from '@shared/agent-run-state'
import { sessionOwnsTask } from '../../hooks/usePlanningWorkspace'
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  IconButton,
  Menu,
  SearchField,
  Select,
  TextArea,
  TextField,
  useConfirm,
  useReorderMotion,
  type MenuEntry
} from '../../ui'
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Eye,
  GripVertical,
  Hourglass,
  Icon,
  Inbox,
  Pause,
  Play,
  Repeat
} from '../../ui/icons'
import { AgentRunBadge } from './AgentRunBadge'
import { RunModelPicker, runModelLine } from './RunModelPicker'
import { useAgentModelSettings } from '../../hooks/planning/useAgentModelSettings'
import type { AgentRunChoice } from '@shared/agent-model'
import './AgentsView.css'
import { stopAgent } from '../workspace/agents/stop-agent'
import { t } from '@shared/i18n'

const PRIORITY_OPTIONS = [
  {
    value: 'critical',
    get label() {
      return t('agents:executionQueueSection.critical')
    }
  },
  {
    value: 'high',
    get label() {
      return t('agents:executionQueueSection.high')
    }
  },
  {
    value: 'medium',
    get label() {
      return t('agents:executionQueueSection.medium')
    }
  },
  {
    value: 'low',
    get label() {
      return t('agents:executionQueueSection.low')
    }
  }
]

interface ExecutionQueueSectionProps {
  id: string
  harnessState: HarnessProjectState
  reviewSessions: HarnessSession[]
  runnableHarnessTasks: HarnessTask[]
  planningWorkItems: PlanningWorkItem[]
  planningMilestones: PlanningMilestone[]
  harnessBusy: boolean
  openPlanningTask: (task: PlanningWorkItem) => void
  copyPlanningTaskHandoff: (task: PlanningWorkItem) => Promise<void>
  /** A one-click start is waiting for its workspace to be prepared. */
  startingSession?: boolean
  startSandboxedSession: () => Promise<void>
  startEmbeddedSession: (taskId: string) => Promise<void>
  nudgeHarnessTask: (taskId: string, direction: -1 | 1) => Promise<void>
  toggleHarnessTaskAutoContinue: (task: HarnessTask) => Promise<void>
  changeHarnessTaskPriority: (task: HarnessTask, priority: PlanningPriority) => Promise<void>
  cancelHarnessTask: (task: HarnessTask) => Promise<void>
  /** Copies the session's prompt again (built in main) and shows its masked preview. */
  resumeSessionPrompt: (session: { id: string }) => Promise<void>
  runHarnessAction: (action: () => Promise<{ ok: boolean; error?: string }>) => Promise<boolean>
  persistHarnessQueueOrder: (orderedTaskIds: string[]) => Promise<boolean>
  openSessionReview?: (sessionId: string) => void
  openSessionTranscript?: (sessionId: string) => void
  /** Opens the choice of model for a queued task's run (D42). */
  chooseRunModel?: (task: HarnessTask) => void
}

export function ExecutionQueueSection({
  id,
  harnessState,
  reviewSessions,
  runnableHarnessTasks,
  planningWorkItems,
  planningMilestones,
  harnessBusy,
  startingSession = false,
  openPlanningTask,
  copyPlanningTaskHandoff,
  startSandboxedSession,
  startEmbeddedSession,
  nudgeHarnessTask,
  toggleHarnessTaskAutoContinue,
  changeHarnessTaskPriority,
  cancelHarnessTask,
  resumeSessionPrompt,
  runHarnessAction,
  persistHarnessQueueOrder,
  openSessionReview,
  openSessionTranscript,
  chooseRunModel
}: ExecutionQueueSectionProps) {
  const confirm = useConfirm()
  const [taskTitle, setTaskTitle] = useState('')
  const queueRef = useRef<HTMLOListElement | null>(null)
  useReorderMotion(queueRef)
  const [taskDetails, setTaskDetails] = useState('')
  const [taskPriority, setTaskPriority] = useState<PlanningPriority>('medium')
  const [taskRunChoice, setTaskRunChoice] = useState<AgentRunChoice>({ model: '', effort: '' })
  const modelSettings = useAgentModelSettings(id)
  const executionFilter = useSearchFilter({ stage: 'all', priority: 'all', completed: 'hidden' })
  const harnessTaskQuery = executionFilter.query
  const setHarnessTaskQuery = executionFilter.setQuery
  const harnessTaskFilter = executionFilter.filters.stage as AgentRunFilter
  const setHarnessTaskFilter = (value: AgentRunFilter) =>
    executionFilter.setFilterValue('stage', value)
  const harnessTaskPriorityFilter = executionFilter.filters.priority as PlanningPriority | 'all'
  const setHarnessTaskPriorityFilter = (value: PlanningPriority | 'all') =>
    executionFilter.setFilterValue('priority', value)
  const includeCompleted = executionFilter.filters.completed === 'shown'
  const setIncludeCompleted = (value: boolean) =>
    executionFilter.setFilterValue('completed', value ? 'shown' : 'hidden')
  /**
   * Finished work is history, not queue: it accumulates forever and pushed the
   * rows you can still act on down the list. Selecting Accepted
   * explicitly is itself a request to see them, so the default only applies
   * while some other state is selected.
   */
  const hideCompleted = !includeCompleted && harnessTaskFilter !== 'accepted'
  // One state per run, from the shared rule the Board and the API agree with.
  const runState = (task: HarnessTask): AgentRunState => agentRunState(task, harnessState)
  const [draggedHarnessTaskId, setDraggedHarnessTaskId] = useState<string | null>(null)
  const [autoDispatchConfig, setAutoDispatchConfig] = useState<ProjectAutoDispatchConfig | null>(
    null
  )

  useEffect(() => {
    if (!id) return
    void window.ostlerAPI.getProjectAutoDispatchConfig(id).then((res) => {
      if (res.ok) setAutoDispatchConfig(res.value)
    })
  }, [id])

  const moveHarnessTask = async (sourceTaskId: string, targetTaskId: string) => {
    if (sourceTaskId === targetTaskId) return
    const orderedTaskIds = runnableHarnessTasks.map((task) => task.id)
    const sourceIndex = orderedTaskIds.indexOf(sourceTaskId)
    const targetIndex = orderedTaskIds.indexOf(targetTaskId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const [moved] = orderedTaskIds.splice(sourceIndex, 1)
    orderedTaskIds.splice(targetIndex, 0, moved)
    await persistHarnessQueueOrder(orderedTaskIds)
  }

  const cancelAllQueued = async () => {
    if (runnableHarnessTasks.length === 0) return
    const ok = await confirm({
      title: t('agents:executionQueueSection.cancelAllQueuedAgent', {
        count: runnableHarnessTasks.length
      }),
      body: t('agents:executionQueueSection.theirHistoryKeptTheir'),
      confirmLabel: t('agents:executionQueueSection.cancelAllQueuedRuns'),
      cancelLabel: t('agents:executionQueueSection.keepQueued'),
      tone: 'danger'
    })
    if (!ok) return
    for (const task of runnableHarnessTasks) {
      await cancelHarnessTask(task)
    }
  }

  /** Reordering one step at a time meant ten clicks to promote the last task. */
  const moveHarnessTaskToEdge = async (taskId: string, edge: 'top' | 'bottom') => {
    const orderedTaskIds = runnableHarnessTasks.map((task) => task.id)
    const index = orderedTaskIds.indexOf(taskId)
    if (index < 0) return
    const [moved] = orderedTaskIds.splice(index, 1)
    if (edge === 'top') orderedTaskIds.unshift(moved)
    else orderedTaskIds.push(moved)
    await persistHarnessQueueOrder(orderedTaskIds)
  }

  const sortHarnessQueueByPriority = async () => {
    const weight: Record<PlanningPriority, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1
    }
    const orderedTaskIds = runnableHarnessTasks
      .map((task, index) => ({
        task,
        index,
        priority:
          planningWorkItems.find(
            (item) => item.linkedHarnessTaskId === task.id || item.id === task.planningWorkItemId
          )?.priority ?? task.priority
      }))
      .sort(
        (left, right) => weight[right.priority] - weight[left.priority] || left.index - right.index
      )
      .map(({ task }) => task.id)
    await persistHarnessQueueOrder(orderedTaskIds)
  }

  const completedTaskCount = harnessState.taskQueue.filter(
    (task) => runState(task) === 'accepted'
  ).length

  const harnessTaskCounts = new Map(
    AGENT_RUN_FILTERS.map((value) => [
      value,
      value === 'all'
        ? // The "Open" chip counts what selecting it would actually show.
          (harnessState.taskQueue.length ?? 0) - (hideCompleted ? completedTaskCount : 0)
        : harnessState.taskQueue.filter((task) => runState(task) === value).length
    ])
  )

  // Work you can act on first. With "all" selected the queue was ordered by
  // creation, so a long tail of completed tasks sat above everything still to
  // run -- the actionable rows were the ones you had to scroll to find.
  const STAGE_ORDER = Object.fromEntries(
    AGENT_RUN_FILTERS.map((state, index) => [state, index])
  ) as Record<string, number>

  const filteredHarnessTasks = (harnessState.taskQueue ?? []).filter((task) => {
    const query = harnessTaskQuery.trim().toLowerCase()
    const linkedWork = planningWorkItems.find(
      (item) => item.linkedHarnessTaskId === task.id || item.id === task.planningWorkItemId
    )
    const priority = linkedWork?.priority ?? task.priority
    return (
      !(hideCompleted && runState(task) === 'accepted') &&
      (harnessTaskFilter === 'all' || runState(task) === harnessTaskFilter) &&
      (harnessTaskPriorityFilter === 'all' || priority === harnessTaskPriorityFilter) &&
      (!query ||
        task.title.toLowerCase().includes(query) ||
        task.details.toLowerCase().includes(query) ||
        linkedWork?.title.toLowerCase().includes(query))
    )
  })

  const orderedHarnessTasks =
    harnessTaskFilter === 'all'
      ? [...filteredHarnessTasks].sort(
          (left, right) =>
            (STAGE_ORDER[runState(left)] ?? 99) - (STAGE_ORDER[runState(right)] ?? 99)
        )
      : filteredHarnessTasks

  return (
    <section
      className="agents-section agents-queue"
      aria-label={t('agents:executionQueueSection.agentExecutionQueue')}
    >
      <header className="agents-section__header">
        <h3>{t('agents:executionQueueSection.queue')}</h3>
        <span className="agents-section__meta">
          {t('common:count.task', { count: harnessState.taskQueue.length })}
        </span>
      </header>

      <div
        className="agents-stats"
        role="group"
        aria-label={t('agents:executionQueueSection.agentRunStatus')}
      >
        {AGENT_RUN_FILTERS.map((filter) => (
          <button
            type="button"
            key={filter}
            className="agents-stat"
            aria-pressed={harnessTaskFilter === filter}
            onClick={() => setHarnessTaskFilter(filter)}
          >
            <strong>{harnessTaskCounts.get(filter) ?? 0}</strong>
            <span>{agentRunFilterLabel(filter)}</span>
          </button>
        ))}
      </div>

      <div className="agents-queue__toolbar">
        <SearchField
          label={t('agents:executionQueueSection.searchAgentRuns')}
          hideLabel
          placeholder={t('agents:executionQueueSection.searchAgentRuns')}
          value={harnessTaskQuery}
          onChange={(event) => setHarnessTaskQuery(event.target.value)}
          className="agents-queue__search"
        />
        <Select
          label={t('agents:executionQueueSection.filterAgentRunsPriority')}
          hideLabel
          size="sm"
          value={harnessTaskPriorityFilter}
          onChange={(event) =>
            setHarnessTaskPriorityFilter(event.target.value as PlanningPriority | 'all')
          }
          options={[
            { value: 'all', label: t('agents:executionQueueSection.allPriorities') },
            ...PRIORITY_OPTIONS
          ]}
        />
        <span title={t('agents:executionQueueSection.completedTasksHiddenDefault')}>
          <Checkbox
            label={
              completedTaskCount > 0
                ? t('agents:executionQueueSection.includeCompleted', { completedTaskCount })
                : t('agents:executionQueueSection.includeCompleted2')
            }
            checked={includeCompleted}
            onChange={(event) => setIncludeCompleted(event.target.checked)}
          />
        </span>
        <span className="agents-queue__count">
          {t('agents:executionQueueSection.showing', {
            filteredHarnessTaskCount: filteredHarnessTasks.length,
            taskQueueCount: harnessState.taskQueue.length
          })}
        </span>
        {executionFilter.isFiltered && (
          <Button variant="ghost" size="sm" onClick={executionFilter.clearAll}>
            {t('agents:executionQueueSection.clearFilters')}
          </Button>
        )}
        <span className="agents-queue__spacer" />
        <Badge
          tone={autoDispatchConfig?.enabled ? 'success' : 'neutral'}
          icon={autoDispatchConfig?.enabled ? Play : Pause}
          title={
            autoDispatchConfig?.enabled
              ? t('agents:executionQueueSection.queuedTasksRunAutomatically')
              : t('agents:executionQueueSection.queuedTasksDontRun')
          }
        >
          {autoDispatchConfig?.enabled
            ? t('agents:executionQueueSection.autoRunOn', {
                count: autoDispatchConfig.maxConcurrentEmbeddedSessions
              })
            : t('agents:executionQueueSection.autoRunOff')}
        </Badge>
        <Button
          variant="secondary"
          size="sm"
          disabled={harnessBusy || runnableHarnessTasks.length < 2}
          onClick={() => void sortHarnessQueueByPriority()}
        >
          {t('agents:executionQueueSection.sortQueuePriority')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="agents-danger-text"
          disabled={harnessBusy || runnableHarnessTasks.length === 0}
          title={t('agents:executionQueueSection.cancelEveryQueuedAgent')}
          onClick={() => void cancelAllQueued()}
        >
          {t('agents:executionQueueSection.clearQueue')}
        </Button>
      </div>

      {filteredHarnessTasks.length > 0 ? (
        <ol
          ref={queueRef}
          className="agents-queue__list ostler-execution-task-list"
          aria-label={t('agents:executionQueueSection.agentRunList')}
        >
          {orderedHarnessTasks.map((task) => {
            const stage = runState(task)
            const linkedWork = planningWorkItems.find(
              (item) => item.linkedHarnessTaskId === task.id || item.id === task.planningWorkItemId
            )
            const linkedMilestone = linkedWork
              ? planningMilestones.find((milestone) => milestone.id === linkedWork.milestoneId)
              : null
            const session = [...harnessState.activeSessions, ...reviewSessions].find((candidate) =>
              sessionOwnsTask(candidate, task)
            )
            const queuePosition = runnableHarnessTasks.findIndex(
              (candidate) => candidate.id === task.id
            )
            // The actions follow the task's own status, as before; only the
            // words come from the run state.
            // A task whose copy is still being made shows "Getting ready" (§2.1).
            const queued = task.status === 'pending' && task.copy?.state !== 'preparing'
            const first = queued && queuePosition === 0
            const last = queuePosition === runnableHarnessTasks.length - 1
            const running = task.status === 'claimed'
            const modelLine =
              stage === 'cancelled' || stage === 'accepted'
                ? null
                : runModelLine(task, session, modelSettings)

            const menuEntries: MenuEntry[] = []
            if (first) {
              menuEntries.push({
                label: t('agents:executionQueueSection.runBuiltAgent'),
                hint: t('agents:executionQueueSection.runsTaskBuiltAgent'),
                disabled: harnessBusy,
                onSelect: () => void startEmbeddedSession(task.id)
              })
            }
            if (queued && chooseRunModel) {
              menuEntries.push({
                label: t('agents:runModel.chooseModel'),
                hint: t('agents:runModel.chooseModelHint'),
                disabled: harnessBusy,
                onSelect: () => chooseRunModel(task)
              })
            }
            if (linkedWork && queued) {
              menuEntries.push({
                label: t('agents:executionQueueSection.copyPromptToken'),
                onSelect: () => void copyPlanningTaskHandoff(linkedWork)
              })
            }
            if (queued) {
              menuEntries.push(
                {
                  label: task.autoContinue
                    ? t('agents:executionQueueSection.stopHandingSameAgent')
                    : t('agents:executionQueueSection.handSameAgent'),
                  icon: Repeat,
                  onSelect: () => void toggleHarnessTaskAutoContinue(task)
                },
                {
                  label: task.hold
                    ? t('agents:executionQueueSection.takeOffHold')
                    : t('agents:executionQueueSection.putHold'),
                  icon: task.hold ? Play : Pause,
                  onSelect: () =>
                    void runHarnessAction(() =>
                      window.ostlerAPI.setHarnessTaskHold(id, task.id, !task.hold)
                    )
                },
                { type: 'separator' },
                {
                  label: t('agents:executionQueueSection.cancelTask'),
                  tone: 'danger',
                  disabled: harnessBusy,
                  onSelect: () => void cancelHarnessTask(task)
                }
              )
            }
            if (running && session) {
              menuEntries.push({
                label: t('agents:stopAgent.stop'),
                tone: 'danger',
                hint: t('agents:stopAgent.body'),
                disabled: harnessBusy,
                onSelect: () =>
                  void stopAgent({
                    projectId: id,
                    session: { id: session.id, title: task.title },
                    confirm,
                    runHarnessAction
                  })
              })
            }

            return (
              <li
                key={task.id}
                data-motion-key={task.id}
                className={`agents-run ostler-execution-task${draggedHarnessTaskId === task.id ? ' is-dragging' : ''}`}
                data-stage={stage}
                draggable={queued && !harnessBusy}
                onDragStart={(event) => {
                  if (!queued) return
                  setDraggedHarnessTaskId(task.id)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', task.id)
                }}
                onDragOver={(event) => {
                  if (queued && draggedHarnessTaskId) {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const sourceTaskId =
                    draggedHarnessTaskId || event.dataTransfer.getData('text/plain')
                  if (sourceTaskId && queued) {
                    void moveHarnessTask(sourceTaskId, task.id)
                  }
                }}
                onDragEnd={() => setDraggedHarnessTaskId(null)}
              >
                <span
                  className="agents-run__grip"
                  title={t('agents:executionQueueSection.dragReorderQueue')}
                >
                  {queued && <Icon icon={GripVertical} />}
                </span>

                <div className="agents-run__main">
                  <div className="agents-run__title-row">
                    <h4>{task.title}</h4>
                    <AgentRunBadge state={stage} queuePosition={queuePosition} />
                    {task.autoContinue && (
                      <Badge icon={Repeat} tone="neutral">
                        {t('agents:executionQueueSection.autoContinue')}
                      </Badge>
                    )}
                    {task.hold && (
                      <Badge icon={Pause} tone="warning">
                        {t('agents:executionQueueSection.hold')}
                      </Badge>
                    )}
                    {/* Distinct from a hold: nobody paused this and nobody has
                        to release it. It queues itself forward as the work it
                        depends on finishes. */}
                    {(task.waitingOnDependencies ?? 0) > 0 && (
                      <Badge
                        icon={Hourglass}
                        tone="neutral"
                        title={t('agents:executionQueueSection.queuedStartsOwnOnce')}
                      >
                        {t('agents:executionQueueSection.waitingOnDependencies', {
                          count: task.waitingOnDependencies
                        })}
                      </Badge>
                    )}
                  </div>
                  <p className="agents-run__details">
                    {task.details || t('agents:executionQueueSection.noDetailsWereGiven')}
                  </p>
                  <div className="agents-run__context">
                    {linkedWork ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openPlanningTask(linkedWork)}
                      >
                        {stage === 'cancelled'
                          ? t('agents:executionQueueSection.returnedProjectPlanning')
                          : t('agents:executionQueueSection.openTask')}
                        {linkedMilestone ? ` · ${linkedMilestone.name}` : null}
                      </Button>
                    ) : (
                      <span>{t('agents:executionQueueSection.oneOffAgentRun')}</span>
                    )}
                    {stage === 'starting' && (
                      <span>{t('agents:executionQueueSection.copyGettingReady')}</span>
                    )}
                    {task.status === 'pending' && task.copy?.state === 'failed' && (
                      <span title={task.copy.failure}>
                        {t('agents:executionQueueSection.copyFailed')}
                      </span>
                    )}
                    {(stage === 'running' || stage === 'waitingForYou') && (
                      <span>
                        {session?.title
                          ? t('agents:executionQueueSection.namedWorking', { agent: session.title })
                          : t('agents:executionQueueSection.agentWorking')}
                      </span>
                    )}
                    {(stage === 'inReview' || stage === 'accepted') &&
                      (session || task.claimedBy) && (
                        <span>
                          {session?.title
                            ? t('agents:executionQueueSection.runByNamed', {
                                agent: session.title
                              })
                            : t('agents:executionQueueSection.runByAgent')}
                        </span>
                      )}
                    {task.playbook && (
                      <span>
                        {t('agents:playbooks.fromPlaybook', { name: task.playbook.name })}
                      </span>
                    )}
                    {task.scheduled && <span>{t('agents:playbooks.scheduled')}</span>}
                    {modelLine && <span>{modelLine}</span>}
                    {queued && queuePosition > 0 && (
                      <span>
                        {t('agents:executionQueueSection.tasksAhead', { count: queuePosition })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="agents-run__priority">
                  <Select
                    label={t('agents:executionQueueSection.priority', { taskTitle: task.title })}
                    hideLabel
                    size="sm"
                    value={linkedWork?.priority ?? task.priority}
                    disabled={harnessBusy || stage === 'cancelled'}
                    onChange={(event) =>
                      void changeHarnessTaskPriority(task, event.target.value as PlanningPriority)
                    }
                    options={PRIORITY_OPTIONS}
                  />
                  {linkedWork && stage !== 'cancelled' && (
                    <small>{t('agents:executionQueueSection.keptStepTask')}</small>
                  )}
                </div>

                <div className="agents-run__actions">
                  {queued && (
                    <div
                      className="agents-run__order"
                      role="group"
                      aria-label={t('agents:executionQueueSection.order', {
                        taskTitle: task.title
                      })}
                    >
                      <IconButton
                        size="sm"
                        icon={ArrowUpToLine}
                        label={t('agents:executionQueueSection.moveFrontQueue', {
                          taskTitle: task.title
                        })}
                        disabled={harnessBusy || queuePosition === 0}
                        onClick={() => void moveHarnessTaskToEdge(task.id, 'top')}
                      />
                      <IconButton
                        size="sm"
                        icon={ArrowUp}
                        label={t('agents:executionQueueSection.moveEarlier', {
                          taskTitle: task.title
                        })}
                        disabled={harnessBusy || queuePosition === 0}
                        onClick={() => void nudgeHarnessTask(task.id, -1)}
                      />
                      <IconButton
                        size="sm"
                        icon={ArrowDown}
                        label={t('agents:executionQueueSection.moveLater', {
                          taskTitle: task.title
                        })}
                        disabled={harnessBusy || last}
                        onClick={() => void nudgeHarnessTask(task.id, 1)}
                      />
                      <IconButton
                        size="sm"
                        icon={ArrowDownToLine}
                        label={t('agents:executionQueueSection.moveBackQueue', {
                          taskTitle: task.title
                        })}
                        disabled={harnessBusy || last}
                        onClick={() => void moveHarnessTaskToEdge(task.id, 'bottom')}
                      />
                    </div>
                  )}
                  {first && (
                    <Button
                      variant="primary"
                      size="sm"
                      icon={Play}
                      disabled={harnessBusy}
                      title={t('agents:executionQueueSection.startsConnectedAgentRun')}
                      onClick={() => void startSandboxedSession()}
                    >
                      {startingSession
                        ? t('agents:executionQueueSection.preparingWorkspace')
                        : t('agents:executionQueueSection.startTask')}
                    </Button>
                  )}
                  {running &&
                    session?.provenance !== 'embedded' &&
                    session &&
                    !session.lastSeenAt && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void resumeSessionPrompt(session)}
                      >
                        {t('agents:executionQueueSection.showPromptAgain')}
                      </Button>
                    )}
                  {/* Reviewing a finished run was the only way in; the reader
                      needs it most while the agent is still working. */}
                  {session && openSessionTranscript && stage !== 'cancelled' && (
                    <Button
                      variant={running ? 'secondary' : 'ghost'}
                      size="sm"
                      icon={Eye}
                      title={t('agents:executionQueueSection.openLiveTranscriptEvery')}
                      onClick={() => openSessionTranscript(session.id)}
                    >
                      {running
                        ? t('agents:executionQueueSection.watchLive')
                        : t('agents:executionQueueSection.viewTranscript')}
                    </Button>
                  )}
                  {stage === 'inReview' && session?.workspace && openSessionReview && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => openSessionReview(session.id)}
                    >
                      {t('agents:executionQueueSection.reviewChanges')}
                    </Button>
                  )}
                  {menuEntries.length > 0 && (
                    <Menu
                      label={t('agents:executionQueueSection.moreActions', {
                        taskTitle: task.title
                      })}
                      items={menuEntries}
                      placement="bottom-end"
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      ) : (
        <EmptyState
          icon={Inbox}
          headingLevel={3}
          title={
            harnessState.taskQueue.length === 0
              ? t('agents:executionQueueSection.agentQueueEmpty')
              : hideCompleted && completedTaskCount === harnessState.taskQueue.length
                ? t('agents:executionQueueSection.nothingLeftRun')
                : t('agents:executionQueueSection.noAgentRunsMatch')
          }
          description={
            harnessState.taskQueue.length === 0
              ? t('agents:executionQueueSection.queueReadyTaskBoard')
              : hideCompleted && completedTaskCount === harnessState.taskQueue.length
                ? // Otherwise "nothing matches your filters" reads as a bug when
                  // the user set no filters and the queue is simply all done.
                  t('agents:executionQueueSection.completedRunsHidden', {
                    count: completedTaskCount
                  })
                : undefined
          }
        />
      )}

      <details className="agents-disclosure">
        <summary>{t('agents:executionQueueSection.queueOneOffAgent')}</summary>
        <p>{t('agents:executionQueueSection.unplannedWorkOnlyCreate')}</p>
        <div className="agents-form">
          <TextField
            label={t('agents:executionQueueSection.agentRunTitle')}
            value={taskTitle}
            onChange={(event) => setTaskTitle(event.target.value)}
            placeholder={t('agents:executionQueueSection.whatShouldAgentDo')}
          />
          <TextArea
            label={t('agents:executionQueueSection.agentRunDetails')}
            rows={2}
            value={taskDetails}
            onChange={(event) => setTaskDetails(event.target.value)}
            placeholder={t('agents:executionQueueSection.scopeConstraintsExpectedResult')}
          />
          <Select
            label={t('agents:executionQueueSection.agentRunPriority')}
            value={taskPriority}
            onChange={(event) => setTaskPriority(event.target.value as PlanningPriority)}
            options={PRIORITY_OPTIONS}
          />
          {modelSettings && (
            <RunModelPicker
              settings={modelSettings}
              value={taskRunChoice}
              onChange={setTaskRunChoice}
            />
          )}
          <Button
            variant="primary"
            disabled={harnessBusy || !taskTitle.trim()}
            onClick={async () => {
              const ok = await runHarnessAction(() =>
                window.ostlerAPI.addHarnessTask(
                  id,
                  taskTitle,
                  taskDetails,
                  taskPriority,
                  taskRunChoice.model || taskRunChoice.effort ? taskRunChoice : undefined
                )
              )
              if (ok) {
                setTaskTitle('')
                setTaskDetails('')
                setTaskPriority('medium')
                setTaskRunChoice({ model: '', effort: '' })
              }
            }}
          >
            {t('agents:executionQueueSection.addQueue')}
          </Button>
        </div>
      </details>
    </section>
  )
}
