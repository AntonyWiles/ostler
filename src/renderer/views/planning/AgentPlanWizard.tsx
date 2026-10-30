import { useCallback, useEffect, useState } from 'react'
import type {
  AIMasterPlanDraft,
  AITaskSplitDraft,
  PlanningWorkItem,
  TaskSplitJob
} from '@shared/ostler-api'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { assertResult } from '../../utils/unwrap-result'
import {
  flattenPlanTaskNodes,
  initialPlanTaskTreeEdits,
  PlanTaskTree,
  type PlanTaskTreeEdit,
  type PlanTaskTreeEdits
} from './PlanTaskTree'
import { AiByline, AiWarnings } from '../../components/AiByline'
import { AiTaskReviewAddButton, AiTaskReviewCount } from '../../components/AiTaskReview'
import { Button, Checkbox, Dialog, InlineAlert, ProgressBar, Spinner, TextArea } from '../../ui'
import { ChevronLeft, ChevronRight } from '../../ui/icons'
import { LibrarySourcesStep } from './LibrarySourcesStep'
import './planning-dialogs.css'
import { WizardSteps } from '../../components/WizardSteps'
import './AgentPlanWizard.css'
import { t } from '@shared/i18n'

type WizardStep = 'sources' | 'master-plan' | 'splitting' | 'task-split' | 'done'

export function AgentPlanWizard({ ws }: { ws: PlanningWorkspace }) {
  const goal = ws.agentPlanGoal
  const [step, setStep] = useState<WizardStep>('sources')
  // Library items chosen for this plan (Always items are added by main).
  const [sourceIds, setSourceIds] = useState<string[]>(ws.agentPlanSourceIds)
  useEffect(() => {
    setSourceIds(ws.agentPlanSourceIds)
  }, [goal?.id, ws.agentPlanSourceIds])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [masterPlan, setMasterPlan] = useState<AIMasterPlanDraft | null>(null)
  const [summary, setSummary] = useState('')
  const [auditFindings, setAuditFindings] = useState<string[]>([])
  const [nonNegotiableRules, setNonNegotiableRules] = useState<string[]>([])
  const [phaseIncluded, setPhaseIncluded] = useState<Map<string, boolean>>(new Map())

  const [job, setJob] = useState<TaskSplitJob | null>(null)
  const [taskSplit, setTaskSplit] = useState<AITaskSplitDraft | null>(null)
  const [edits, setEdits] = useState<PlanTaskTreeEdits>(new Map())
  const [createdItems, setCreatedItems] = useState<PlanningWorkItem[] | null>(null)

  // Loads the finished draft a completed job produced and moves on to review.
  const adoptFinishedJob = useCallback(
    async (finished: TaskSplitJob) => {
      if (!finished.draftId) return
      try {
        const result = await window.ostlerAPI.getAITaskSplitDraft(
          finished.projectId,
          finished.draftId
        )
        assertResult(result)
        setTaskSplit(result.value)
        setEdits(initialPlanTaskTreeEdits(result.value.phases.flatMap((phase) => phase.tasks)))
        setStep('task-split')
      } catch (draftError) {
        setError(
          draftError instanceof Error
            ? draftError.message
            : t('ai:agentPlanWizard.couldntLoadFinishedSplit')
        )
      }
    },
    [setEdits, setError, setStep, setTaskSplit]
  )

  // The split runs in the background, so the wizard may be reopened mid-run or
  // after it finished. Pick the job back up rather than starting a second one.
  useEffect(() => {
    if (!goal) return
    let active = true
    void (async () => {
      const result = await window.ostlerAPI.getAITaskSplitJob(goal.projectId, goal.id)
      if (!active || !result.ok || !result.value) return
      const existing = result.value
      setJob(existing)
      if (existing.status === 'running' || existing.status === 'failed') setStep('splitting')
      else if (existing.status === 'done') await adoptFinishedJob(existing)
    })()
    return () => {
      active = false
    }
  }, [goal, adoptFinishedJob])

  useEffect(() => {
    if (!goal) return undefined
    return window.ostlerAPI.onTaskSplitProgress((incoming) => {
      if (incoming.projectId !== goal.projectId || incoming.goalId !== goal.id) return
      setJob(incoming)
      if (incoming.status === 'failed') setError(incoming.error)
      if (incoming.status === 'done') void adoptFinishedJob(incoming)
    })
  }, [goal, adoptFinishedJob])

  if (!goal) return null

  const reset = () => {
    setStep('sources')
    setMasterPlan(null)
    setJob(null)
    setTaskSplit(null)
    setEdits(new Map())
    setCreatedItems(null)
    setError(null)
  }

  const close = () => {
    reset()
    ws.closeAgentPlanWizard()
  }

  const generateMasterPlan = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.ostlerAPI.generateAIMasterPlan(goal.projectId, goal.id, sourceIds)
      assertResult(result)
      setMasterPlan(result.value)
      setSummary(result.value.summary)
      setAuditFindings(result.value.auditFindings)
      setNonNegotiableRules(result.value.nonNegotiableRules)
      setPhaseIncluded(new Map(result.value.phases.map((phase) => [phase.code, true])))
    } catch (planError) {
      setError(
        planError instanceof Error
          ? planError.message
          : t('ai:agentPlanWizard.couldntGeneratePlanTry')
      )
    } finally {
      setBusy(false)
    }
  }

  const approveMasterPlanAndSplit = async () => {
    if (!masterPlan) return
    setBusy(true)
    setError(null)
    try {
      const phases = masterPlan.phases.map((phase) => ({
        ...phase,
        included: phaseIncluded.get(phase.code) ?? true
      }))
      const approveResult = await window.ostlerAPI.approveAIMasterPlan(
        goal.projectId,
        goal.id,
        masterPlan.draftId,
        { summary, auditFindings, nonNegotiableRules, phases }
      )
      assertResult(approveResult)
      // Returns as soon as the job starts; phases arrive over the progress channel.
      const startResult = await window.ostlerAPI.startAITaskSplit(
        goal.projectId,
        goal.id,
        masterPlan.draftId,
        sourceIds
      )
      assertResult(startResult)
      setJob(startResult.value)
      setStep('splitting')
    } catch (splitError) {
      setError(
        splitError instanceof Error
          ? splitError.message
          : t('ai:agentPlanWizard.couldntSplitIntoTasks')
      )
    } finally {
      setBusy(false)
    }
  }

  const retryPhase = async (phaseCode: string) => {
    if (!job) return
    setError(null)
    try {
      const result = await window.ostlerAPI.retryAITaskSplitPhase(job.jobId, phaseCode)
      assertResult(result)
      setJob(result.value)
    } catch (retryError) {
      setError(
        retryError instanceof Error
          ? retryError.message
          : t('ai:agentPlanWizard.couldntRetryPhaseTry')
      )
    }
  }

  const cancelSplit = async () => {
    if (!job) return
    try {
      const result = await window.ostlerAPI.cancelAITaskSplit(job.jobId)
      assertResult(result)
      setJob(result.value)
      setStep('master-plan')
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : t('ai:agentPlanWizard.couldntCancelSplitTry')
      )
    }
  }

  const toggleNode = (code: string, included: boolean) => {
    setEdits((current) => {
      const next = new Map(current)
      const edit = next.get(code)
      if (edit) next.set(code, { ...edit, included })
      return next
    })
  }

  const editNode = (code: string, patch: Partial<PlanTaskTreeEdit>) => {
    setEdits((current) => {
      const next = new Map(current)
      const edit = next.get(code)
      if (edit) next.set(code, { ...edit, ...patch })
      return next
    })
  }

  const includedCount = [...edits.values()].filter((edit) => edit.included).length
  const missingTitle = [...edits.values()].some((edit) => edit.included && !edit.title.trim())
  // The split runs one AI call per included phase, so the wait scales with them.
  const includedPhaseCount = [...phaseIncluded.values()].filter(Boolean).length

  const createTasks = async () => {
    if (!taskSplit) return
    setBusy(true)
    setError(null)
    try {
      const allNodes = flattenPlanTaskNodes(taskSplit.phases.flatMap((phase) => phase.tasks))
      const nodes = allNodes.map((node) => {
        const edit = edits.get(node.code)!
        return {
          code: node.code,
          included: edit.included,
          title: edit.title,
          context: node.context,
          task: edit.task,
          constraints: node.constraints,
          acceptanceCriteria: node.acceptanceCriteria,
          outOfScope: node.outOfScope,
          preconditions: node.preconditions,
          references: node.references,
          deliverables: node.deliverables,
          reliesOn: node.reliesOn,
          priority: edit.priority,
          attachments: edit.attachments
        }
      })
      const result = await window.ostlerAPI.createAgentPlanTasks(
        goal.projectId,
        goal.id,
        taskSplit.draftId,
        null,
        { phases: taskSplit.phases.map(({ code, name }) => ({ code, name })), nodes }
      )
      assertResult(result)
      setCreatedItems(result.value)
      setStep('done')
      await ws.loadPlanning()
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : t('ai:agentPlanWizard.couldntCreatePlanTasks')
      )
    } finally {
      setBusy(false)
    }
  }

  const stage = stageOf(step)
  const phasesDone = job ? job.phases.filter((phase) => phase.status === 'done').length : 0

  const footer = (
    <>
      {step === 'sources' && (
        <>
          <Button onClick={close} disabled={busy}>
            {t('ai:agentPlanWizard.cancel')}
          </Button>
          <Button variant="primary" iconEnd={ChevronRight} onClick={() => setStep('master-plan')}>
            {t('ai:agentPlanWizard.next')}
          </Button>
        </>
      )}
      {step === 'master-plan' && (
        <>
          <Button icon={ChevronLeft} onClick={() => setStep('sources')} disabled={busy}>
            {t('ai:agentPlanWizard.back')}
          </Button>
          {!masterPlan ? (
            <Button variant="ai" loading={busy} onClick={() => void generateMasterPlan()}>
              {t('ai:agentPlanWizard.draftPlan')}
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={busy}
              disabled={includedPhaseCount === 0}
              disabledReason={t('ai:agentPlanWizard.includeLeastOnePhase')}
              onClick={() => void approveMasterPlanAndSplit()}
            >
              {t('ai:agentPlanWizard.approveSplitPhases', { count: includedPhaseCount })}
            </Button>
          )}
        </>
      )}
      {step === 'splitting' && job && (
        <>
          <Button icon={ChevronLeft} onClick={() => void cancelSplit()}>
            {job.status === 'running'
              ? t('ai:agentPlanWizard.stopSplitting')
              : t('ai:agentPlanWizard.back')}
          </Button>
          {taskSplit && (
            <Button iconEnd={ChevronRight} onClick={() => setStep('task-split')}>
              {t('ai:agentPlanWizard.next')}
            </Button>
          )}
          <Button variant="primary" onClick={close}>
            {t('ai:agentPlanWizard.closeKeepRunning')}
          </Button>
        </>
      )}
      {step === 'task-split' && (
        <>
          <Button icon={ChevronLeft} onClick={() => setStep('splitting')} disabled={busy || !job}>
            {t('ai:agentPlanWizard.back')}
          </Button>
          <Button onClick={close} disabled={busy}>
            {t('ai:agentPlanWizard.cancel')}
          </Button>
          <AiTaskReviewAddButton
            count={includedCount}
            missingTitle={missingTitle}
            loading={busy}
            onClick={() => void createTasks()}
          />
        </>
      )}
      {step === 'done' && (
        <Button variant="primary" onClick={close}>
          {t('ai:agentPlanWizard.close')}
        </Button>
      )}
    </>
  )

  return (
    <Dialog
      open
      size="lg"
      onClose={close}
      canDismiss={!busy}
      closeOnBackdrop={false}
      title={t('ai:agentPlanWizard.planSplitIntoTasks', { goalTitle: goal.title })}
      description={STAGE_DESCRIPTION[stage]}
      footer={footer}
      className="plan-wizard"
    >
      <div className="dialog-form">
        <WizardSteps steps={STAGES.map(stageName)} current={STAGES.indexOf(stage)} />

        {error && <InlineAlert tone="danger">{error}</InlineAlert>}

        {step === 'sources' && (
          <LibrarySourcesStep
            projectId={goal.projectId}
            selectedIds={sourceIds}
            onChange={setSourceIds}
            disabled={busy}
          />
        )}

        {step === 'master-plan' && !masterPlan && (
          <p>{t('ai:agentPlanWizard.draftsPlanGoalSummary')}</p>
        )}

        {step === 'master-plan' && masterPlan && (
          <>
            <AiByline model={masterPlan.model} at={masterPlan.generatedAt} />
            <AiWarnings warnings={masterPlan.warnings} />
            <TextArea
              label={t('ai:agentPlanWizard.summary')}
              value={summary}
              rows={3}
              disabled={busy}
              onChange={(event) => setSummary(event.target.value)}
            />
            {auditFindings.length > 0 && (
              <section className="dialog-section">
                <h3 className="dialog-section__title">
                  {t('ai:agentPlanWizard.whatAlreadyExists')}
                </h3>
                <ul className="dialog-list">
                  {auditFindings.map((finding, index) => (
                    <li key={`audit-${index}`}>{finding}</li>
                  ))}
                </ul>
              </section>
            )}
            {nonNegotiableRules.length > 0 && (
              <section className="dialog-section">
                <h3 className="dialog-section__title">
                  {t('ai:agentPlanWizard.rulesEveryTaskKeeps')}
                </h3>
                <ul className="dialog-list">
                  {nonNegotiableRules.map((rule, index) => (
                    <li key={`rule-${index}`}>{rule}</li>
                  ))}
                </ul>
              </section>
            )}
            <fieldset className="dialog-checklist__fieldset">
              <legend>{t('ai:agentPlanWizard.phases')}</legend>
              {masterPlan.phases.map((phase) => (
                <Checkbox
                  key={phase.code}
                  label={`${phase.code} · ${phase.name}`}
                  hint={phase.objective}
                  checked={phaseIncluded.get(phase.code) ?? true}
                  disabled={busy}
                  onChange={(event) =>
                    setPhaseIncluded((current) => {
                      const next = new Map(current)
                      next.set(phase.code, event.target.checked)
                      return next
                    })
                  }
                />
              ))}
            </fieldset>
          </>
        )}

        {step === 'splitting' && job && (
          <>
            <p>{t('ai:agentPlanWizard.eachPhaseSplitTurn')}</p>
            <ProgressBar
              label={t('ai:agentPlanWizard.phasesSplit')}
              showLabel
              value={phasesDone}
              max={Math.max(job.phases.length, 1)}
              valueText={t('ai:agentPlanWizard.phases2', { count: job.phases.length, phasesDone })}
            />
            <ol className="plan-wizard__phases">
              {job.phases.map((phase) => (
                <li key={phase.code} data-status={phase.status}>
                  <span className="plan-wizard__code">{phase.code}</span>
                  <strong>{phase.name}</strong>
                  <span className="plan-wizard__phase-state">
                    {phase.status === 'pending' && t('ai:agentPlanWizard.waiting')}
                    {phase.status === 'running' && (
                      <>
                        <Spinner size="sm" /> {t('ai:agentPlanWizard.planning')}
                      </>
                    )}
                    {phase.status === 'done' && t('common:count.task', { count: phase.taskCount })}
                    {phase.status === 'failed' && (phase.error ?? t('ai:agentPlanWizard.failed'))}
                  </span>
                  {phase.status === 'failed' && (
                    <Button size="sm" onClick={() => void retryPhase(phase.code)}>
                      {t('ai:agentPlanWizard.retryPhase')}
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}

        {step === 'task-split' && taskSplit && (
          <>
            <AiByline model={taskSplit.model} at={taskSplit.generatedAt} />
            <p>{t('ai:agentPlanWizard.untickAnythingDontWant')}</p>
            <AiWarnings warnings={taskSplit.warnings ?? []} />
            <AiTaskReviewCount included={includedCount} total={edits.size} />
            <PlanTaskTree
              projectId={goal.projectId}
              phases={taskSplit.phases}
              edits={edits}
              onToggle={toggleNode}
              onEdit={editNode}
              disabled={busy}
            />
          </>
        )}

        {step === 'done' && createdItems && (
          <>
            <InlineAlert
              tone="success"
              title={t('ai:agentPlanWizard.createdTasks', { count: createdItems.length })}
            >
              {t('ai:agentPlanWizard.tasksNothingLeftWait')}
            </InlineAlert>
            <ul className="dialog-list">
              {createdItems.map((item) => (
                <li key={item.id}>
                  <span className="plan-wizard__code">{item.taskCode}</span> {item.title}
                  {item.linkedHarnessTaskId ? t('ai:agentPlanWizard.queued') : ''}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  )
}

const STAGES = ['Sources', 'Plan', 'Tasks', 'Review'] as const
type Stage = (typeof STAGES)[number]

/** A stage's name as the step list shows it. */
function stageName(stage: Stage): string {
  return t(`ai:agentPlanWizard.stage.${stage}`)
}

const STAGE_DESCRIPTION: Record<Stage, string> = {
  get Sources() {
    return t('ai:agentPlanWizard.chooseWhatOstlerAi')
  },
  get Plan() {
    return t('ai:agentPlanWizard.reviewPlanPhasesBefore')
  },
  get Tasks() {
    return t('ai:agentPlanWizard.phasesBeingSplitInto')
  },
  get Review() {
    return t('ai:agentPlanWizard.checkTasksThenCreate')
  }
}

/** Which of the four steps a wizard state belongs to. */
function stageOf(step: WizardStep): Stage {
  if (step === 'sources') return 'Sources'
  if (step === 'master-plan') return 'Plan'
  if (step === 'splitting') return 'Tasks'
  return 'Review'
}
