import type { HarnessPlan, HarnessSession, HarnessTask, WatchedProject } from '@shared/ostler-api'
import {
  MAX_PLAN_CHANGES_NOTE_LENGTH,
  MAX_PLAN_FILES,
  MAX_PLAN_RISKS_LENGTH,
  MAX_PLAN_STEP_LENGTH,
  MAX_PLAN_STEPS,
  PLAN_FIRST_AVAILABLE
} from '@shared/plan-first'
import { Refusal } from '@shared/refusal'
import type { HarnessContext } from './context'
import { getSessionDiff } from './task-copies'
import { stopSession } from './task-review'
import {
  emptyState,
  normalizeRelativePath,
  requireSession,
  type StoredHarnessState,
  type StoredSession,
  type StoredTask
} from './types'

/**
 * Plan first (N9.3a): a plan-first task's agent sends a plan and waits on the
 * person, who approves it, asks for changes or cancels. One set of rules for
 * the embedded bridge and the harness API alike; the plan lives on the
 * session in `state.json`.
 */

/** What an agent sent, checked and capped. */
export interface PlanInput {
  steps: string[]
  files: string[]
  risks: string
}

/**
 * Checks a plan from an agent. The text is the agent's own: plain text, never
 * interpreted, and refused rather than cut when it is over a limit, so the
 * person never approves a plan that is not the one the agent sent.
 */
export function parsePlanInput(raw: {
  steps?: unknown
  files?: unknown
  risks?: unknown
}): PlanInput {
  if (!Array.isArray(raw.steps)) throw new Refusal('A plan needs steps: a list of strings')
  const steps = raw.steps
    .map((step, index) => {
      if (typeof step !== 'string') throw new Refusal(`Step ${index + 1} is not a string`)
      return step.trim()
    })
    .filter((step) => step.length > 0)
  if (steps.length === 0) throw new Refusal('A plan needs at least one step')
  if (steps.length > MAX_PLAN_STEPS) {
    throw new Refusal(
      `A plan may have at most ${MAX_PLAN_STEPS} steps; this one has ${steps.length}`
    )
  }
  steps.forEach((step, index) => {
    if (step.length > MAX_PLAN_STEP_LENGTH) {
      throw new Refusal(
        `Step ${index + 1} is ${step.length} characters; a step may be at most ${MAX_PLAN_STEP_LENGTH}`
      )
    }
  })

  const rawFiles = raw.files ?? []
  if (!Array.isArray(rawFiles)) throw new Refusal('files must be a list of relative paths')
  const files: string[] = []
  for (const file of rawFiles) {
    if (typeof file !== 'string') throw new Refusal('files must be a list of relative paths')
    if (!file.trim()) continue
    let normalized: string
    try {
      normalized = normalizeRelativePath(file)
    } catch {
      throw new Refusal(`Not a path relative to the project: ${file.slice(0, 200)}`)
    }
    if (!files.includes(normalized)) files.push(normalized)
  }
  if (files.length > MAX_PLAN_FILES) {
    throw new Refusal(
      `A plan may name at most ${MAX_PLAN_FILES} files; this one names ${files.length}`
    )
  }

  if (raw.risks !== undefined && raw.risks !== null && typeof raw.risks !== 'string') {
    throw new Refusal('risks must be a string')
  }
  const risks = (raw.risks ?? '').trim()
  if (risks.length > MAX_PLAN_RISKS_LENGTH) {
    throw new Refusal(
      `risks is ${risks.length} characters; it may be at most ${MAX_PLAN_RISKS_LENGTH}`
    )
  }
  return { steps, files, risks }
}

function sessionTask(state: StoredHarnessState, session: StoredSession): StoredTask | undefined {
  const taskId = session.taskId ?? session.assignedTaskId
  return (
    state.tasks.find((task) => task.id === taskId) ??
    state.tasks.find((task) => task.claimedBy === session.id)
  )
}

/** Whether a session's run must plan first: its task asks for it. */
export function sessionPlanFirst(state: StoredHarnessState, sessionId: string): boolean {
  const session = state.sessions.find((item) => item.id === sessionId)
  return !!session && sessionTask(state, session)?.planFirst === true
}

/**
 * Whether a session may change files: true unless its task asks for a plan
 * first and no plan of it has been approved yet.
 */
export function sessionMayChangeFiles(state: StoredHarnessState, sessionId: string): boolean {
  if (!sessionPlanFirst(state, sessionId)) return true
  const session = state.sessions.find((item) => item.id === sessionId)
  return session?.plan?.status === 'approved'
}

/**
 * Asks a queued task for a plan first, or stops asking. The only way to set
 * `planFirst`; refused while plans are not available (N9.3b's switch calls it).
 */
export function setTaskPlanFirst(
  ctx: HarnessContext,
  project: WatchedProject,
  taskId: string,
  planFirst: boolean
): HarnessTask {
  if (!PLAN_FIRST_AVAILABLE) throw new Refusal('Plan first is not available')
  let updated: StoredTask | undefined
  ctx.mutate(project, (state) => {
    updated = state.tasks.find((task) => task.id === taskId)
    if (!updated) throw new Refusal(`Task ${taskId} not found`)
    if (updated.status !== 'pending') {
      throw new Refusal('Only a task waiting in the queue can change whether it plans first')
    }
    if (planFirst) updated.planFirst = true
    else delete updated.planFirst
  })
  if (!updated) throw new Error('Task update failed')
  return updated
}

function samePlan(plan: HarnessPlan, input: PlanInput): boolean {
  return (
    plan.risks === input.risks &&
    plan.steps.length === input.steps.length &&
    plan.steps.every((step, index) => step === input.steps[index]) &&
    plan.files.length === input.files.length &&
    plan.files.every((file, index) => file === input.files[index])
  )
}

/**
 * An agent sends its plan. Stored on the session with the next version number;
 * the session then waits on the person, as it does for a question. Sending the
 * same plan again while it waits is how an embedded agent keeps waiting, so it
 * returns the plan as it is rather than making a new version.
 */
export function submitPlan(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string,
  raw: { steps?: unknown; files?: unknown; risks?: unknown }
): HarnessPlan {
  const input = parsePlanInput(raw)
  let plan: HarnessPlan | undefined
  let created = false
  let title = ''
  ctx.mutate(project, (state) => {
    const session = requireSession(state, sessionId)
    title = session.title
    if (session.status === 'done') throw new Refusal('This session has ended')
    if (!sessionPlanFirst(state, sessionId)) {
      throw new Refusal('Your task does not ask for a plan: do the task')
    }
    const current = session.plan
    if (current?.status === 'approved') {
      throw new Refusal(
        `Plan version ${current.version} is already approved: carry on with the task`
      )
    }
    if (current?.status === 'cancelled') throw new Refusal('This task was cancelled')
    if (current?.status === 'pending' && samePlan(current, input)) {
      plan = current
      return
    }
    const now = new Date().toISOString()
    plan = {
      version: (current?.version ?? 0) + 1,
      steps: input.steps,
      files: input.files,
      risks: input.risks,
      status: 'pending',
      submittedAt: now,
      decidedAt: null,
      changesNote: null
    }
    session.plan = plan
    session.status = 'blocked'
    session.lastUpdate = now
    created = true
  })
  if (!plan) throw new Error('Plan submission failed')
  if (created) {
    ctx.recordEvent(
      project,
      'plan_submitted',
      { id: sessionId, title },
      `Plan version ${plan.version}: ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}`
    )
  }
  return plan
}

/** The pending plan of a session, or a refusal saying why there is none. */
function requirePendingPlan(state: StoredHarnessState, sessionId: string): StoredSession {
  const session = requireSession(state, sessionId)
  if (session.status === 'done') throw new Refusal('This session has ended')
  if (session.plan?.status !== 'pending')
    throw new Refusal('There is no plan waiting for a decision')
  return session
}

/**
 * A plan already decided (N9.3b): approving or sending back twice, from the
 * app and the API at once, gets the decision as it stands instead of a
 * refusal. Null when there is a plan waiting, or none at all.
 */
function alreadyDecided(state: StoredHarnessState, sessionId: string): HarnessPlan | null {
  const plan = state.sessions.find((item) => item.id === sessionId)?.plan
  return plan && plan.status !== 'pending' ? plan : null
}

/** Back to work once nothing else holds the session: a pending question still does. */
function resumeSession(state: StoredHarnessState, session: StoredSession, now: string): void {
  const questionPending = state.questions.some(
    (question) => question.sessionId === session.id && question.status === 'pending'
  )
  if (session.status === 'blocked' && !questionPending) session.status = 'active'
  session.lastUpdate = now
}

/**
 * Files the session's copy changed before approval, committed or not. Read
 * from the copy itself, so it holds for an external agent no hook watched.
 * Empty when the copy cannot be read: approval never waits on Git.
 */
async function filesChangedSoFar(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string
): Promise<string[]> {
  const session = (ctx.loadState(project.id) ?? emptyState()).sessions.find(
    (item) => item.id === sessionId
  )
  if (!session?.workspace) return []
  try {
    const diff = await getSessionDiff(ctx, project, sessionId)
    return [...new Set([...diff.files.map((file) => file.path), ...diff.uncommittedFiles])].sort()
  } catch {
    return []
  }
}

/**
 * The person approves the pending plan: the run carries on, the approved plan
 * stays on the session, and anything the copy changed before approval is
 * recorded on the plan.
 */
export async function approvePlan(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string
): Promise<HarnessPlan> {
  const decided = alreadyDecided(ctx.loadState(project.id) ?? emptyState(), sessionId)
  if (decided) return decided
  requirePendingPlan(ctx.loadState(project.id) ?? emptyState(), sessionId)
  const changed = await filesChangedSoFar(ctx, project, sessionId)
  let plan: HarnessPlan | undefined
  let title = ''
  let raced = null as HarnessPlan | null
  ctx.mutate(project, (state) => {
    // Decided by another surface while the copy was being read.
    raced = alreadyDecided(state, sessionId)
    if (raced) return
    const session = requirePendingPlan(state, sessionId)
    const now = new Date().toISOString()
    title = session.title
    plan = { ...session.plan!, status: 'approved', decidedAt: now }
    if (changed.length > 0) plan.changedBeforeApproval = { files: changed }
    session.plan = plan
    resumeSession(state, session, now)
  })
  if (raced) return raced
  if (!plan) throw new Error('Plan approval failed')
  const before = plan.changedBeforeApproval
    ? ` (${fileCount(plan.changedBeforeApproval.files.length)} changed before the plan was approved)`
    : ''
  ctx.recordEvent(
    project,
    'plan_decided',
    { id: sessionId, title },
    `Approved plan version ${plan.version}${before}`
  )
  return plan
}

function fileCount(count: number): string {
  return `${count} file${count === 1 ? '' : 's'}`
}

/** The person asks for changes with a note; the agent sends a new version. */
export function requestPlanChanges(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string,
  note: string
): HarnessPlan {
  const decided = alreadyDecided(ctx.loadState(project.id) ?? emptyState(), sessionId)
  if (decided) return decided
  const cleanNote = (typeof note === 'string' ? note : '').trim()
  if (!cleanNote) throw new Refusal('Say what to change in the plan')
  if (cleanNote.length > MAX_PLAN_CHANGES_NOTE_LENGTH) {
    throw new Refusal(`The note may be at most ${MAX_PLAN_CHANGES_NOTE_LENGTH} characters`)
  }
  let plan: HarnessPlan | undefined
  let title = ''
  ctx.mutate(project, (state) => {
    const session = requirePendingPlan(state, sessionId)
    const now = new Date().toISOString()
    title = session.title
    plan = { ...session.plan!, status: 'changes-requested', decidedAt: now, changesNote: cleanNote }
    session.plan = plan
    resumeSession(state, session, now)
  })
  if (!plan) throw new Error('Plan update failed')
  ctx.recordEvent(
    project,
    'plan_decided',
    { id: sessionId, title },
    `Asked for changes to plan version ${plan.version}: ${cleanNote}`
  )
  return plan
}

/**
 * The person cancels: the run ends as Stop ends one (its copy's work kept
 * aside for Bring back, its task back in the queue). As for Stop, the caller
 * stops an embedded agent's process first.
 */
export async function cancelPlan(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string
): Promise<HarnessSession> {
  let title = ''
  let version = 0
  ctx.mutate(project, (state) => {
    const session = requirePendingPlan(state, sessionId)
    title = session.title
    version = session.plan!.version
    session.plan = { ...session.plan!, status: 'cancelled', decidedAt: new Date().toISOString() }
  })
  ctx.recordEvent(
    project,
    'plan_decided',
    { id: sessionId, title },
    `Cancelled the task at plan version ${version}`
  )
  return stopSession(ctx, project, sessionId)
}
