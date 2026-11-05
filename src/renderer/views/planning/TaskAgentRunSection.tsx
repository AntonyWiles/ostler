import { useState } from 'react'
import type { HarnessSession, HarnessTask, PlanningWorkItem } from '@shared/ostler-api'
import { diffLineClass, type PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { Button, Checkbox } from '../../ui'
import { runCanRunAgain, sessionRunState } from '@shared/agent-run-state'
import { useAgentModelSettings } from '../../hooks/planning/useAgentModelSettings'
import { runModelLine } from './RunModelPicker'
import { AgentRunBadge } from './AgentRunBadge'
import { TaskAgentPrompt } from './TaskAgentPrompt'
import { AgentReportModal } from './AgentReportModal'
import { RejectWorkForm } from './RejectWorkForm'
import { offerLessonAfterSendBack } from './RememberLesson'
import { TaskDrawerSection } from './TaskDrawerSection'
import { TaskPlanFirst } from './TaskPlanFirst'
import { SendGuidanceButton } from './SendGuidance'
import { useTaskReview } from '../workspace/agents/useTaskReview'
import { t } from '@shared/i18n'

/**
 * Everything about agents working this task, in one collapsible section the
 * drawer shows only while agents are on: the agent's report, handing it to a
 * connected agent, "Auto-continue", and reviewing a run's changes (Apply,
 * Send back, Discard).
 */
export function TaskAgentRunSection({
  ws,
  item
}: {
  ws: PlanningWorkspace
  item: PlanningWorkItem
}) {
  const [reportOpen, setReportOpen] = useState(false)
  const modelSettings = useAgentModelSettings(ws.projectId)
  const session = ws.selectedHarnessSession
  const task = ws.selectedHarnessTask
  const diff = ws.sessionDiff
  const waitingForAgent =
    item.linkedHarnessTaskId !== null &&
    (ws.harnessState?.taskQueue.some(
      (queued) =>
        queued.id === item.linkedHarnessTaskId && queued.status === 'pending' && !queued.claimedBy
    ) ??
      false)

  // The run's state in the shared words; while it waits in review, what
  // review still needs follows it.
  const runState =
    session?.workspace && ws.harnessState ? sessionRunState(session, ws.harnessState) : null
  const reviewDetail =
    runState !== 'inReview'
      ? undefined
      : !diff
        ? t('agents:taskAgentRunSection.checkingChanges')
        : diff.mergeReadiness === 'no_changes'
          ? t('agents:taskAgentRunSection.noCodeChanges')
          : t('agents:taskAgentRunSection.readyAccept')

  return (
    <TaskDrawerSection
      title={t('agents:taskAgentRunSection.agentRun')}
      collapsible
      defaultOpen={Boolean(session?.workspace || task?.report)}
      actions={runState ? <AgentRunBadge state={runState} detail={reviewDetail} /> : undefined}
      className="task-agent-run"
    >
      <Checkbox
        label={t('agents:taskAgentRunSection.autoContinue')}
        hint={t('agents:taskAgentRunSection.onceQueueSameAgent')}
        checked={ws.editAutoQueue}
        disabled={item.linkedHarnessTaskId !== null}
        onChange={(event) => ws.setEditAutoQueue(event.target.checked)}
      />

      <TaskPlanFirst
        projectId={ws.projectId}
        item={item}
        onChanged={() => void ws.loadPlanning()}
        onError={(error) => ws.setError(error)}
      />

      {task?.report && (
        <div className="task-drawer__panel task-drawer__panel--row">
          <div>
            <strong>{t('agents:taskAgentRunSection.agentReport')}</strong>
            <p className="task-drawer__muted">{t('agents:taskAgentRunSection.whatAgentSaidDid')}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setReportOpen(true)}>
            {t('agents:taskAgentRunSection.viewReport')}
          </Button>
        </div>
      )}

      {session && session.status !== 'done' && (
        <div className="task-drawer__panel task-drawer__panel--row">
          <div>
            <strong>{t('agents:taskAgentRunSection.messageAgent')}</strong>
            <p className="task-drawer__muted">{t('agents:taskAgentRunSection.messageAgentHint')}</p>
          </div>
          <SendGuidanceButton projectId={ws.projectId} session={session} runTitle={item.title} />
        </div>
      )}

      {task?.playbook && (
        <p className="task-drawer__muted">
          {t('agents:playbooks.fromPlaybook', { name: task.playbook.name })}
        </p>
      )}
      {task?.scheduled && <p className="task-drawer__muted">{t('agents:playbooks.scheduled')}</p>}
      {task && runModelLine(task, session, modelSettings) && (
        <div className="task-drawer__panel task-drawer__panel--row">
          <div>
            <strong>{runModelLine(task, session, modelSettings)}</strong>
            {waitingForAgent && (
              <p className="task-drawer__muted">{t('agents:runModel.chooseModelHint')}</p>
            )}
          </div>
          {waitingForAgent && (
            <Button
              size="sm"
              variant="secondary"
              disabled={ws.busy}
              onClick={() => ws.setRunModelTarget({ kind: 'change', task })}
            >
              {t('agents:runModel.change')}
            </Button>
          )}
        </div>
      )}

      <TaskAgentPrompt ws={ws} item={item} />

      {session?.workspace && (
        <div
          className="task-agent-run__changes"
          aria-label={t('agents:taskAgentRunSection.agentChanges')}
        >
          <p className="task-drawer__muted">
            {session.status === 'done'
              ? t('agents:taskAgentRunSection.lookOverChangesThen')
              : t('agents:taskAgentRunSection.previewRefreshesWhileAgent')}
          </p>
          {ws.sessionDiffLoading && !diff ? (
            <p className="task-drawer__muted">{t('agents:taskAgentRunSection.loadingChanges')}</p>
          ) : diff ? (
            <>
              <div className="task-agent-run__summary">
                <strong>{t('common:count.file', { count: diff.filesChanged })}</strong>
                <span className="is-added">+{diff.insertions}</span>
                <span className="is-removed">-{diff.deletions}</span>
              </div>
              {diff.patch ? (
                <pre
                  className="task-agent-run__patch"
                  aria-label={t('agents:taskAgentRunSection.changedCodePreview')}
                >
                  <code>
                    {diff.patch.split('\n').map((line, index) => (
                      <span className={`is-${diffLineClass(line)}`} key={`${index}-${line}`}>
                        {line || ' '}
                        {'\n'}
                      </span>
                    ))}
                  </code>
                </pre>
              ) : (
                <p className="task-drawer__muted">
                  {t('agents:taskAgentRunSection.agentHasntChangedAnything')}
                </p>
              )}
              {diff.versionChanged && (
                <p className="task-drawer__muted">
                  {t('agents:needsYouSection.versionChangedNote', {
                    task: diff.taskVersion,
                    folder: diff.folderVersion
                  })}
                </p>
              )}
              {diff.patchTruncated && (
                <p className="task-drawer__muted">
                  {t('agents:taskAgentRunSection.previewShowsFirst200')}
                </p>
              )}
            </>
          ) : null}
          {session.status === 'done' && !session.workspace.closed && (
            <DrawerReviewActions ws={ws} session={session} task={task ?? undefined} />
          )}
        </div>
      )}

      {reportOpen && task && <AgentReportModal task={task} onClose={() => setReportOpen(false)} />}
    </TaskDrawerSection>
  )
}

/**
 * The drawer's verdicts on a finished run: the same hook, words and order as
 * the Agents view's "Ready for you to review".
 */
function DrawerReviewActions({
  ws,
  session,
  task
}: {
  ws: PlanningWorkspace
  session: HarnessSession
  task: HarnessTask | undefined
}) {
  const [sendingBack, setSendingBack] = useState<'sendBack' | 'runAgain' | null>(null)
  const runHarnessAction = async (
    action: () => Promise<{ ok: boolean; error?: string }>
  ): Promise<boolean> => {
    const result = await action()
    if (!result.ok) {
      ws.setError(result.error || t('agents:agentsTab.didntWorkTryAgain'))
      return false
    }
    await ws.loadPlanning()
    return true
  }
  const { diff, nothingChanged, apply, discard } = useTaskReview({
    projectId: ws.projectId,
    session,
    runHarnessAction
  })
  return (
    <>
      <div className="task-drawer__row-actions">
        {!nothingChanged && (
          <Button
            size="sm"
            variant="ghost"
            disabled={ws.busy}
            title={t('agents:taskAgentRunSection.sendWorkBackReason')}
            onClick={() => setSendingBack((open) => (open === 'sendBack' ? null : 'sendBack'))}
          >
            {sendingBack === 'sendBack'
              ? t('agents:taskReview.cancelSendBack')
              : t('agents:taskReview.sendBack')}
          </Button>
        )}
        {runCanRunAgain(session, task) && (
          <Button
            size="sm"
            variant="secondary"
            disabled={ws.busy}
            title={t('agents:runModel.runAgainWithHint')}
            aria-expanded={sendingBack === 'runAgain'}
            onClick={() => setSendingBack((open) => (open === 'runAgain' ? null : 'runAgain'))}
          >
            {t('agents:runModel.runAgainWith')}
          </Button>
        )}
        {!nothingChanged && (
          <Button size="sm" variant="secondary" disabled={ws.busy} onClick={() => void discard()}>
            {t('agents:taskReview.discard')}
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          disabled={ws.busy || !diff}
          title={
            nothingChanged
              ? t('agents:taskReview.closeNothingChangedHint')
              : t('agents:taskReview.applyHint')
          }
          onClick={() => void apply()}
        >
          {nothingChanged
            ? t('agents:taskReview.closeNothingChanged')
            : t('agents:taskReview.apply')}
        </Button>
      </div>
      {sendingBack && (
        <RejectWorkForm
          key={sendingBack}
          projectId={ws.projectId}
          busy={ws.busy}
          runAgain={sendingBack === 'runAgain'}
          initialChoice={{ model: task?.model ?? '', effort: task?.effort ?? '' }}
          commentCount={session.reviewDrafts?.length ?? 0}
          onReject={(reason, disposition, runAgainWith) => {
            setSendingBack(null)
            const sent = session.reviewDrafts
            void runHarnessAction(async () => {
              const result = await window.ostlerAPI.sendBackHarnessTaskWork(
                ws.projectId,
                session.id,
                reason,
                disposition,
                runAgainWith
              )
              if (result.ok) offerLessonAfterSendBack(ws.projectId, session, task, reason, sent)
              return result
            })
          }}
        />
      )}
    </>
  )
}
