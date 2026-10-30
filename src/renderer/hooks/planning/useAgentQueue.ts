import { useEffect, useRef, useState } from 'react'
import { assertResult } from '../../utils/unwrap-result'
import { projectPath } from '../../navigation/paths'
import { sessionOwnsTask } from '@shared/work-item-status'
import {
  agentPill,
  executionLabel as executionLabelFor,
  queuePosition,
  queueSummary as summariseQueue,
  queueWait,
  runnableHarnessTasks as runnableTasksIn,
  waitingHarnessTasks as waitingTasksIn
} from '@shared/planning/queue'
import type { AgentRunChoice } from '@shared/agent-model'
import type {
  HarnessSession,
  HarnessSessionDiff,
  HarnessTask,
  PlanningWorkItem
} from '@shared/ostler-api'
import type { PlanningRunner } from './usePlanningRunner'
import type { PlanningRecords } from './usePlanningRecords'
import type { PlanningSelectors } from './usePlanningSelectors'
import type { WorkItemDrawer } from './useWorkItemDrawer'
import { t } from '@shared/i18n'
import { hiddenQueueRefusal, hiddenReason } from '@shared/planning/show-from'
import { todayIsoDate } from '@shared/dates'
import { useConfirm } from '../../ui/Confirm'

/**
 * Planning's view of the agent harness: the queue and where each item sits
 * in it, queueing and starting work, the sessions working it, questions,
 * transcripts, and reviewing a finished session's workspace (merge, commit,
 * reject, discard). Depends on the runner, records, selectors and drawer.
 */
export function useAgentQueue(
  projectId: string,
  navigate: (path: string) => void,
  runner: PlanningRunner,
  records: PlanningRecords,
  selectors: PlanningSelectors,
  drawer: WorkItemDrawer
) {
  const { busy, setError } = runner
  const { runBusy } = runner.internal
  const { harnessState, workItems, loadPlanning } = records
  const { setWorkItems, setHarnessState } = records.internal
  const { harnessTaskFor } = selectors
  const { selectedWorkItem, openWorkItem } = drawer
  const confirm = useConfirm()

  // Which session's transcript is open. Held here rather than in PlanningView
  // so a board card, the toolbar and the harness dialog can all raise the same
  // window without threading a callback through the board.
  const [transcriptSessionId, setTranscriptSessionId] = useState<string | null>(null)
  /** Session whose workspace review the board has opened, if any. */
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null)
  const [sessionDiff, setSessionDiff] = useState<HarnessSessionDiff | null>(null)
  const [sessionDiffLoading, setSessionDiffLoading] = useState(false)
  /**
   * The work item whose agent handoff was just copied, not merely "something
   * was copied": every board card renders this same control, so a single
   * boolean ticked the confirmation on all of them at once.
   */
  const [handoffCopiedId, setHandoffCopiedId] = useState<string | null>(null)
  /**
   * The task whose run model is being chosen (D42): a work item about to be
   * queued, or a task waiting in the queue. ProjectWorkspace shows the dialog.
   */
  const [runModelTarget, setRunModelTarget] = useState<
    { kind: 'queue'; item: PlanningWorkItem } | { kind: 'change'; task: HarnessTask } | null
  >(null)

  const refreshHarnessState = async (forProjectId = projectId) => {
    const harnessResult = await window.ostlerAPI.getHarnessState(forProjectId)
    if (harnessResult.ok) setHarnessState(harnessResult.value)
  }

  const runnableHarnessTasks = runnableTasksIn(harnessState)
  const waitingHarnessTasks = waitingTasksIn(harnessState)
  const queueSummary = summariseQueue(harnessState)
  const pendingQuestions =
    harnessState?.questions.filter((question) => question.status === 'pending') ?? []
  const reviewSessions = harnessState?.reviewSessions ?? []

  const executionLabel = (item: PlanningWorkItem): string | null =>
    executionLabelFor(item, harnessState)
  const agentPillOf = (item: PlanningWorkItem) => agentPill(item, harnessState)
  const queuePositionOf = (item: PlanningWorkItem) => queuePosition(item, runnableHarnessTasks)
  const queueWaitOf = (item: PlanningWorkItem): number => queueWait(item, waitingHarnessTasks)

  /**
   * Every open session, newest first. Embedded ones carry the full picture --
   * Ostler runs the process and records each tool call -- while an external
   * agent's transcript holds whatever it posted over the harness API. Both are
   * worth opening; excluding external sessions left the toolbar saying
   * "1 running" with nothing to look at.
   */
  const watchableSessions = (harnessState?.activeSessions ?? [])
    .slice()
    .sort((left, right) => right.lastUpdate.localeCompare(left.lastUpdate))

  /**
   * The session working this item right now, whether it has already claimed
   * the task or is still connecting. Board cards use it to offer the
   * transcript for work that is genuinely underway.
   */
  const sessionForWorkItem = (item: PlanningWorkItem): HarnessSession | null => {
    const task = harnessTaskFor(item)
    if (!task) return null
    return (
      (harnessState?.activeSessions ?? []).find((session) => sessionOwnsTask(session, task)) ?? null
    )
  }

  /**
   * The finished session holding this item in Review. The board needs it to
   * offer the merge/accept decision on the card itself: a card parked in
   * Review with no visible action is indistinguishable from a stuck one, and
   * everything depending on it stays blocked until someone decides.
   */
  const reviewSessionForItem = (item: PlanningWorkItem): HarnessSession | null => {
    const task = harnessTaskFor(item)
    if (!task) return null
    return (
      (harnessState?.reviewSessions ?? []).find((session) => sessionOwnsTask(session, task)) ?? null
    )
  }

  const queueWorkItem = async (item: PlanningWorkItem, runChoice?: AgentRunChoice) => {
    // This button is already an explicit human queue action. Using a native
    // confirm dialog made it appear unresponsive when that popup failed to
    // surface on Windows.
    // A hidden task (N1.1a) is refused by the main process; offer to bring it
    // back (out of Someday, or its show-from date cleared) and queue it in one step.
    const today = todayIsoDate()
    const refusal = hiddenQueueRefusal(item, today)
    const hidden = hiddenReason(item, today)
    if (refusal && hidden) {
      const bringBack = await confirm({
        title: t('tasks:someday.queueHiddenTitle', { title: item.title }),
        body: `${refusal}. ${
          hidden.kind === 'someday'
            ? t('tasks:someday.queueBringBackSomeday')
            : t('tasks:someday.queueBringBackLater')
        }`,
        confirmLabel: t('tasks:someday.queueBringBack')
      }).catch(() => false)
      if (!bringBack) return
    }
    await runBusy(
      t('tasks:useAgentQueue.couldntQueueTaskTry'),
      async () => {
        if (hidden) {
          const shown = await window.ostlerAPI.updatePlanningWorkItem(
            item.id,
            hidden.kind === 'someday' ? { someday: false } : { showFrom: null }
          )
          assertResult(shown)
          setWorkItems((current) =>
            current.map((candidate) => (candidate.id === item.id ? shown.value : candidate))
          )
        }
        const result = await window.ostlerAPI.queuePlanningWorkItem(
          item.projectId,
          item.id,
          runChoice
        )
        assertResult(result)
        setWorkItems((current) =>
          current.map((candidate) =>
            candidate.id === result.value.workItem.id ? result.value.workItem : candidate
          )
        )
        await refreshHarnessState(item.projectId)
      },
      { subject: item.id }
    )
  }

  /** Changes the model and effort for a queued task's run; main refuses once it has started. */
  const setTaskRunModel = async (task: HarnessTask, choice: AgentRunChoice) =>
    Boolean(
      await runBusy(t('agents:runModel.couldntChangeModel'), async () => {
        assertResult(await window.ostlerAPI.setHarnessTaskRunModel(projectId, task.id, choice))
        await refreshHarnessState()
        return true
      })
    )

  /**
   * Queues a whole selection in one call. The main process orders the work
   * dependencies-first and reports what it skipped, so a partial result is
   * stated rather than looking like nothing happened.
   */
  const queueWorkItems = async (workItemIds: string[]) => {
    if (workItemIds.length === 0 || !projectId) return null
    return (
      (await runBusy(t('tasks:useAgentQueue.couldntQueueTasksTry'), async () => {
        const result = await window.ostlerAPI.queuePlanningWorkItems(projectId, workItemIds)
        assertResult(result)
        const queuedById = new Map(
          result.value.queued.map((handoff) => [handoff.workItem.id, handoff.workItem])
        )
        setWorkItems((current) =>
          current.map((candidate) => queuedById.get(candidate.id) ?? candidate)
        )
        await refreshHarnessState()
        if (result.value.skipped.length > 0) {
          const [first] = result.value.skipped
          setError(
            result.value.skipped.length === 1
              ? t('tasks:useAgentQueue.skipped', { firstTitle: first.title, reason: first.reason })
              : t('tasks:useAgentQueue.queuedSkippedStarting', {
                  queuedCount: result.value.queued.length,
                  skippedCount: result.value.skipped.length,
                  firstTitle: first.title,
                  reason: first.reason
                })
          )
        }
        return result.value
      })) ?? null
    )
  }

  /**
   * The harness only starts the task at the front of the queue, and only when a
   * workspace slot is free. Both rules are enforced here so the board offers
   * Start exactly when the dialog would.
   */
  const canStartAgent = (item: PlanningWorkItem) => queuePositionOf(item) === 0 && !busy

  const startWorkItemAgent = async (item: PlanningWorkItem) => {
    const task = harnessTaskFor(item)
    if (!task || !canStartAgent(item)) return
    await runBusy(
      t('tasks:useAgentQueue.couldntStartAgentTry'),
      async () => {
        const result = await window.ostlerAPI.startHarnessEmbeddedSession(projectId, task.id)
        if (!result.ok) setError(result.error)
        else await loadPlanning()
      },
      { subject: item.id }
    )
  }

  const selectedHarnessTask = selectedWorkItem?.linkedHarnessTaskId
    ? (harnessState?.taskQueue.find((task) => task.id === selectedWorkItem.linkedHarnessTaskId) ??
      null)
    : null
  const selectedHarnessSession: HarnessSession | null = selectedHarnessTask
    ? ([...(harnessState?.reviewSessions ?? []), ...(harnessState?.activeSessions ?? [])].find(
        (session) => sessionOwnsTask(session, selectedHarnessTask)
      ) ?? null)
    : null

  useEffect(() => {
    if (!selectedHarnessSession || !projectId) {
      setSessionDiff(null)
      setSessionDiffLoading(false)
      return
    }
    let cancelled = false
    setSessionDiff(null)
    const loadDiff = async () => {
      setSessionDiffLoading(true)
      const result = await window.ostlerAPI.getHarnessSessionDiff(
        projectId,
        selectedHarnessSession.id
      )
      if (!cancelled) {
        if (result.ok) setSessionDiff(result.value)
        else setError(result.error || t('tasks:useAgentQueue.couldntLoadAgentsChanges'))
        setSessionDiffLoading(false)
      }
    }
    void loadDiff()
    const interval = window.setInterval(() => void loadDiff(), 7500)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [projectId, selectedHarnessSession?.id])

  /**
   * One pending reset at a time. Two copies in quick succession used to leave
   * the first item's timer running, so it cleared the second item's tick early.
   */
  const handoffCopyTimer = useRef<number | null>(null)

  const copyAgentHandoff = async (item: PlanningWorkItem) => {
    setError(null)
    // Built and copied by main, which holds the token the handoff carries.
    const copied = await window.ostlerAPI.copyPlanningAgentHandoff(item.projectId, item.id)
    if (!copied.ok) {
      setError(copied.error)
      return
    }
    setHandoffCopiedId(item.id)
    if (handoffCopyTimer.current !== null) window.clearTimeout(handoffCopyTimer.current)
    handoffCopyTimer.current = window.setTimeout(() => setHandoffCopiedId(null), 2000)
  }

  /**
   * Where to send someone who needs to act on an agent workspace but has no
   * work item to open. Overview is the real destination: its drift table
   * lists every workspace Ostler manages, with each one's branch and whether
   * it has uncommitted changes.
   */
  const openAgentAttention = () => navigate(projectPath(projectId, 'overview'))

  /**
   * Opens the drawer for the work item a review session belongs to, so a
   * workspace can be merged or discarded without leaving Planning. Falls back
   * to the project view only when no work item claims the session.
   */
  const openSessionWorkItem = (session: HarnessSession) => {
    const task = harnessState?.taskQueue.find((candidate) => sessionOwnsTask(session, candidate))
    const item = task
      ? workItems.find((candidate) => candidate.linkedHarnessTaskId === task.id)
      : undefined
    if (item) openWorkItem(item)
    else openAgentAttention()
  }

  return {
    executionLabel,
    runnableHarnessTasks,
    queueSummary,
    agentPillOf,
    queuePositionOf,
    queueWaitOf,
    queueWorkItem,
    queueWorkItems,
    setTaskRunModel,
    runModelTarget,
    setRunModelTarget,
    canStartAgent,
    startWorkItemAgent,
    pendingQuestions,
    reviewSessions,
    watchableSessions,
    sessionForWorkItem,
    reviewSessionForItem,
    transcriptSessionId,
    setTranscriptSessionId,
    reviewSessionId,
    setReviewSessionId,
    selectedHarnessTask,
    selectedHarnessSession,
    sessionDiff,
    sessionDiffLoading,
    handoffCopiedId,
    copyAgentHandoff,
    openAgentAttention,
    openSessionWorkItem
  }
}
