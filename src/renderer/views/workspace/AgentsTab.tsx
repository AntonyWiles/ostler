import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { HarnessTask, PlanningPriority } from '@shared/ostler-api'
import { sessionOwnsTask, type PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import type { ProjectViewProps } from '../../navigation/view-props'
import { projectPath } from '../../navigation/paths'
import { isHarnessPort } from '@shared/harness-url'
import { ExecutionQueueSection } from '../planning/ExecutionQueueSection'
import { SessionReviewModal } from '../planning/SessionReviewModal'
import { AgentQuestionsPanel } from '../planning/AgentQuestionsPanel'
import { PendingPlansPanel, pendingPlanSessions } from '../planning/PendingPlansPanel'
import { Badge, Button, InlineAlert, Select, Switch, useConfirm } from '../../ui'
import { Bot, Eye } from '../../ui/icons'
import { NeedsYouSection, reviewFocusFallback } from './agents/NeedsYouSection'
import { RunningNowSection } from './agents/RunningNowSection'
import { AgentHistorySection } from './agents/AgentHistorySection'
import '../planning/AgentsView.css'
import { t } from '@shared/i18n'

/**
 * The project's agent work (simplify pass §7): the status and the switches
 * that govern the queue, then two lists -- Ready for you to review (with
 * agent questions) and Working now -- the Queue, and the run history (R5.3).
 * Past runs also show in each task's activity and in the project's History.
 * Review and transcripts stay dialogs opened from here.
 */
export function AgentsTab({ project, ws }: ProjectViewProps) {
  const projectId = project.id
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  // True while a one-click start waits for the workspace to be prepared.
  const [preparingSession, setPreparingSession] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The prompt carries the session's token, so main builds it and copies it;
  // this holds only the masked preview and which session it belongs to.
  const [sessionPrompt, setSessionPrompt] = useState<{
    sessionId: string
    preview: string
  } | null>(null)
  const [promptCopied, setPromptCopied] = useState(false)
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null)
  const navigate = useNavigate()
  const harnessState = ws.harnessState
  const reviewSessions = harnessState?.reviewSessions ?? []
  // Derived once in the planning workspace so the board and this page cannot
  // disagree about what is runnable.
  const runnableTasks = ws.runnableHarnessTasks

  const openCodeWorkspace = (root: { label: string; path: string }) =>
    navigate(projectPath(projectId, 'files', { rootLabel: root.label, rootPath: root.path }))

  const refresh = async () => {
    await ws.loadPlanning()
  }

  const runHarnessAction = async (
    action: () => Promise<{ ok: boolean; error?: string }>
  ): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      if (!result.ok) {
        setError(result.error || t('agents:agentsTab.didntWorkTryAgain'))
        return false
      }
      await refresh()
      return true
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : t('agents:agentsTab.didntWorkTryAgain')
      )
      return false
    } finally {
      setBusy(false)
    }
  }

  const persistQueueOrder = async (orderedTaskIds: string[]) =>
    runHarnessAction(() => window.ostlerAPI.reorderHarnessTasks(projectId, orderedTaskIds))

  const nudgeTask = async (taskId: string, direction: -1 | 1) => {
    const index = runnableTasks.findIndex((task) => task.id === taskId)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= runnableTasks.length) return
    const orderedTaskIds = runnableTasks.map((task) => task.id)
    ;[orderedTaskIds[index], orderedTaskIds[targetIndex]] = [
      orderedTaskIds[targetIndex],
      orderedTaskIds[index]
    ]
    await persistQueueOrder(orderedTaskIds)
  }

  const toggleAutoContinue = async (task: HarnessTask) => {
    await runHarnessAction(() =>
      window.ostlerAPI.setHarnessTaskAutoContinue(projectId, task.id, !task.autoContinue)
    )
  }

  const changePriority = async (task: HarnessTask, priority: PlanningPriority) => {
    await runHarnessAction(() =>
      window.ostlerAPI.setHarnessTaskPriority(projectId, task.id, priority)
    )
  }

  const cancelTask = async (task: HarnessTask) => {
    const ok = await confirm({
      title: t('agents:agentsTab.cancel', { taskTitle: task.title }),
      body: t('agents:agentsTab.historyKeptTaskGoes'),
      confirmLabel: t('agents:agentsTab.cancelTask'),
      cancelLabel: t('agents:agentsTab.keepQueued'),
      tone: 'danger'
    })
    if (!ok) return
    await runHarnessAction(() => window.ostlerAPI.cancelHarnessTask(projectId, task.id))
  }

  const startEmbeddedSession = async (taskId: string) => {
    await runHarnessAction(() => window.ostlerAPI.startHarnessEmbeddedSession(projectId, taskId))
  }

  /** Builds the session's prompt in main, copies it, and shows the masked preview. */
  const copySessionPrompt = async (sessionId: string): Promise<boolean> => {
    setError(null)
    const result = await window.ostlerAPI.copyHarnessSessionPrompt(projectId, sessionId)
    if (!result.ok) {
      setError(result.error)
      return false
    }
    setSessionPrompt({ sessionId, preview: result.value })
    setPromptCopied(true)
    setTimeout(() => setPromptCopied(false), 2000)
    return true
  }

  const showSessionPrompt = async (session: { id: string }) => {
    await copySessionPrompt(session.id)
  }

  const startSandboxedSession = async () => {
    const task = runnableTasks[0]
    if (!task) {
      setError(t('agents:agentsTab.queueTaskBeforeStart'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const configResult = await window.ostlerAPI.getConfig()
      if (!configResult.ok) {
        setError(t('agents:agentsTab.couldntReadAgentApi', { error: configResult.error }))
        return
      }
      if (!configResult.value.harness.enabled) {
        setError(t('agents:agentsTab.agentApiOffTurn'))
        return
      }
      const port = configResult.value.harness.port
      if (!isHarnessPort(port)) {
        setError(t('agents:agentsTab.agentApiPortIsnt'))
        return
      }
      setPreparingSession(true)
      const result = await window.ostlerAPI.startHarnessTaskSession(projectId, task.id)
      setPreparingSession(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      await copySessionPrompt(result.value.id)
      await refresh()
    } catch (startError) {
      setError(
        startError instanceof Error
          ? startError.message
          : t('agents:agentsTab.couldntStartAgentRun')
      )
    } finally {
      setPreparingSession(false)
      setBusy(false)
    }
  }

  return (
    <div className="agents-view">
      <AgentControls ws={ws} />

      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}

      {sessionPrompt && (
        <details className="agents-disclosure agents-prompt" open>
          <summary>{t('agents:agentsTab.agentPrompt')}</summary>
          <pre>{sessionPrompt.preview}</pre>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void copySessionPrompt(sessionPrompt.sessionId)}
          >
            {promptCopied ? t('agents:agentsTab.copied') : t('agents:agentsTab.copyPrompt')}
          </Button>
        </details>
      )}

      {harnessState?.legacyMigrationProblem && (
        <LegacyMigrationAlert
          projectId={projectId}
          problem={harnessState.legacyMigrationProblem}
          runHarnessAction={runHarnessAction}
        />
      )}

      {/* What needs you comes first: questions, then every finished run
          waiting for review. The "N to review" badge counts these, and they
          stay reachable here even once every task row has completed. */}
      <NeedsYouSection
        projectId={projectId}
        questions={
          ws.pendingQuestions.length > 0 ||
          pendingPlanSessions(harnessState?.activeSessions ?? []).length > 0 ? (
            <>
              <PendingPlansPanel
                projectId={projectId}
                sessions={harnessState?.activeSessions ?? []}
                onDecided={() => void refresh()}
              />
              {ws.pendingQuestions.length > 0 && <AgentQuestionsPanel ws={ws} />}
            </>
          ) : null
        }
        reviewSessions={reviewSessions}
        tasks={harnessState?.taskQueue}
        busy={busy}
        runHarnessAction={runHarnessAction}
        openSessionReview={setReviewSessionId}
      />

      <RunningNowSection
        projectId={projectId}
        sessions={harnessState?.activeSessions ?? []}
        tasks={harnessState?.taskQueue ?? []}
        busy={busy}
        runHarnessAction={runHarnessAction}
        openTranscript={ws.setTranscriptSessionId}
        openSessionReview={setReviewSessionId}
        folderVersion={harnessState?.folderVersion}
      />

      {harnessState ? (
        <ExecutionQueueSection
          id={projectId}
          harnessState={harnessState}
          reviewSessions={reviewSessions}
          runnableHarnessTasks={runnableTasks}
          planningWorkItems={ws.workItems}
          planningMilestones={ws.milestones}
          harnessBusy={busy}
          startingSession={preparingSession}
          openPlanningTask={(item) => ws.openWorkItem(item)}
          copyPlanningTaskHandoff={ws.copyAgentHandoff}
          startSandboxedSession={startSandboxedSession}
          startEmbeddedSession={startEmbeddedSession}
          nudgeHarnessTask={nudgeTask}
          toggleHarnessTaskAutoContinue={toggleAutoContinue}
          changeHarnessTaskPriority={changePriority}
          cancelHarnessTask={cancelTask}
          resumeSessionPrompt={showSessionPrompt}
          runHarnessAction={runHarnessAction}
          persistHarnessQueueOrder={persistQueueOrder}
          openSessionReview={setReviewSessionId}
          openSessionTranscript={ws.setTranscriptSessionId}
          chooseRunModel={(task) => ws.setRunModelTarget({ kind: 'change', task })}
        />
      ) : (
        <p className="agents-muted">{t('agents:agentsTab.agentQueueIsntAvailable')}</p>
      )}

      <AgentHistorySection projectId={projectId} refreshKey={harnessState} />

      {reviewSessionId &&
        (() => {
          const session = [
            ...(harnessState?.reviewSessions ?? []),
            ...(harnessState?.activeSessions ?? [])
          ].find((candidate) => candidate.id === reviewSessionId)
          if (!session) return null
          return (
            <SessionReviewModal
              id={projectId}
              session={session}
              task={harnessState?.taskQueue.find((task) => sessionOwnsTask(session, task))}
              harnessBusy={busy}
              openCodeWorkspace={openCodeWorkspace}
              runHarnessAction={runHarnessAction}
              onClose={() => setReviewSessionId(null)}
              returnFocusTo={reviewFocusFallback}
            />
          )
        })()}
    </div>
  )
}

/**
 * The queue summary as stat tiles, the switches that decide whether queued
 * work starts by itself, and "Watch agent": next to the queue they govern.
 */
function AgentControls({ ws }: { ws: PlanningWorkspace }) {
  const summary = ws.queueSummary
  const autoDispatch = ws.autoDispatch
  const blocked = ws.watchableSessions.some((session) => session.blocked)
  return (
    <section
      className="agents-section agents-controls"
      aria-label={t('agents:agentsTab.agentControls')}
    >
      <div className="agents-controls__top">
        <span
          role="status"
          className="agents-controls__state"
          data-running={summary.running > 0 || undefined}
          title={[
            t('agents:agentsTab.summary.inProgress', { count: summary.running }),
            t('agents:agentsTab.summary.starting', { count: summary.starting }),
            t('agents:agentsTab.summary.queued', { count: summary.queued }),
            t('agents:agentsTab.summary.waiting', { count: summary.waiting }),
            t('agents:agentsTab.summary.review', { count: summary.review }),
            t('agents:agentsTab.summary.openRuns', { count: summary.sessions })
          ].join(' · ')}
        >
          <span className="agents-dot" aria-hidden="true" />
          {summary.running > 0
            ? t('agents:agentsTab.running2', { running: summary.running })
            : summary.starting > 0
              ? t('agents:agentsTab.starting', { starting: summary.starting })
              : t('agents:agentsTab.idle')}
        </span>
        {/* Run playbook (N9.6b): make a task from a playbook and queue it in one step. */}
        <Button variant="secondary" icon={Bot} onClick={() => ws.setRunPlaybookOpen(true)}>
          {t('agents:playbooks.run')}
        </Button>
        {ws.watchableSessions.length > 0 && (
          <Button
            variant={blocked ? 'primary' : 'secondary'}
            icon={Eye}
            onClick={() =>
              ws.setTranscriptSessionId(
                ws.watchableSessions.find((session) => session.blocked)?.id ??
                  ws.watchableSessions[0].id
              )
            }
            title={[
              t('agents:agentsTab.openLiveTranscriptEvery'),
              ...ws.watchableSessions.map((session) =>
                session.blocked
                  ? t('agents:agentsTab.sessionWaitingOnYou', { title: session.title })
                  : session.title
              )
            ].join('\n')}
          >
            {t('agents:agentsTab.watchAgent')}
            {ws.watchableSessions.length > 1 && (
              <Badge tone="accent">{ws.watchableSessions.length}</Badge>
            )}
          </Button>
        )}
      </div>

      <dl className="agents-tiles">
        <div className="agents-tile">
          <dt>{t('agents:agentsTab.running')}</dt>
          <dd>{summary.running}</dd>
        </div>
        <div className="agents-tile">
          <dt>{t('agents:agentsTab.queued')}</dt>
          <dd>{summary.queued}</dd>
        </div>
        <div className="agents-tile" data-tone={summary.review > 0 ? 'warning' : undefined}>
          <dt>{t('agents:agentsTab.review')}</dt>
          <dd>{summary.review}</dd>
        </div>
      </dl>

      <div className="agents-controls__switches">
        <span
          title={
            autoDispatch?.enabled
              ? t('agents:agentsTab.queuedTasksRunAutomatically2', {
                  count: autoDispatch.maxConcurrentEmbeddedSessions
                })
              : t('agents:agentsTab.queuedTasksWaitPress')
          }
        >
          <Switch
            label={t('agents:agentsTab.runAutomatically')}
            checked={Boolean(autoDispatch?.enabled)}
            disabled={ws.busy || !autoDispatch}
            onChange={() => void ws.setAutoDispatchEnabled(!autoDispatch?.enabled)}
          />
        </span>
        {autoDispatch?.enabled && (
          <span title={t('agents:agentsTab.howManyBuiltAgents', { running: summary.running })}>
            <Select
              label={t('agents:agentsTab.mostBuiltAgentsRunning')}
              size="sm"
              value={String(autoDispatch.maxConcurrentEmbeddedSessions)}
              disabled={ws.busy}
              onChange={(event) => void ws.setAutoDispatchConcurrency(Number(event.target.value))}
              options={[1, 2, 3, 4].map((count) => ({
                value: String(count),
                label: String(count)
              }))}
            />
          </span>
        )}
      </div>
    </section>
  )
}

/**
 * "Agent work from before the update needs attention" (§6): moving this
 * project's old agent setup failed, its old folders are untouched, and Try
 * again runs the move once more.
 */
function LegacyMigrationAlert({
  projectId,
  problem,
  runHarnessAction
}: {
  projectId: string
  problem: string
  runHarnessAction: (action: () => Promise<{ ok: boolean; error?: string }>) => Promise<boolean>
}) {
  return (
    <InlineAlert
      tone="warning"
      title={t('agents:agentsTab.legacyNeedsAttention')}
      action={{
        label: t('agents:agentsTab.tryAgain'),
        onClick: () => void runHarnessAction(() => window.ostlerAPI.retryLegacyMigration(projectId))
      }}
    >
      {t('agents:agentsTab.legacyNeedsAttentionBody', { problem })}
    </InlineAlert>
  )
}
