import { randomUUID } from 'crypto'
import type {
  HarnessEventType,
  HarnessTask,
  HarnessTaskPlaybook,
  PlanningPriority,
  WatchedProject
} from '@shared/ostler-api'
import type { AgentRunChoice } from '@shared/agent-model'
import { t } from '@shared/i18n'
import type { HarnessContext } from './context'
import {
  requireTaskPriority,
  type HarnessTaskAction,
  type StoredSession,
  type StoredTask
} from './types'

export function addTask(
  ctx: HarnessContext,
  project: WatchedProject,
  title: string,
  details: string,
  taskId: string = randomUUID().slice(0, 8),
  priority: PlanningPriority = 'medium',
  planningWorkItemId: string | null = null,
  autoContinue = false
): HarnessTask {
  const cleanTitle = title.trim()
  if (!cleanTitle) throw new Error('Task title is required')
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(taskId)) throw new Error('Invalid task identifier')
  const task: StoredTask = {
    id: taskId,
    title: cleanTitle,
    details: details.trim(),
    status: 'pending',
    claimedBy: null,
    priority: requireTaskPriority(priority),
    planningWorkItemId,
    autoContinue,
    hold: false
  }
  let result = task
  let added = false
  ctx.mutate(project, (state) => {
    const existing = state.tasks.find((candidate) => candidate.id === taskId)
    if (existing) {
      if (
        existing.title !== task.title ||
        existing.details !== task.details ||
        existing.planningWorkItemId !== task.planningWorkItemId ||
        existing.autoContinue !== task.autoContinue
      ) {
        throw new Error('Harness task identifier is already in use')
      }
      result = existing
      return
    }
    state.tasks.push(task)
    added = true
  })
  if (added)
    ctx.recordEvent(
      project,
      'task_queued',
      { id: 'human', title: 'human' },
      `queued task ${taskId}`
    )
  return result
}

export function setTaskHold(
  ctx: HarnessContext,
  project: WatchedProject,
  taskId: string,
  hold: boolean
): HarnessTask {
  let updated: StoredTask | undefined
  ctx.mutate(project, (state) => {
    const task = state.tasks.find((candidate) => candidate.id === taskId)
    if (!task) throw new Error('Harness task not found')
    if (task.status !== 'pending') throw new Error('Only pending tasks can change hold status')
    task.hold = Boolean(hold)
    updated = task
  })
  if (!updated) throw new Error('Harness task update failed')
  return { ...updated }
}

export function setTaskAutoContinue(
  ctx: HarnessContext,
  project: WatchedProject,
  taskId: string,
  enabled: boolean
): HarnessTask {
  let updated: StoredTask | undefined
  ctx.mutate(project, (state) => {
    const task = state.tasks.find((candidate) => candidate.id === taskId)
    if (!task) throw new Error('Harness task not found')
    if (task.status !== 'pending') throw new Error('Only pending tasks can change auto-continue')
    task.autoContinue = Boolean(enabled)
    updated = task
  })
  if (!updated) throw new Error('Harness task update failed')
  return { ...updated }
}

/**
 * Sets the model and effort for this task's next run (D42), already validated
 * (`validateAgentRunChoice`). Only while the task waits in the queue: once an
 * agent has been given it, the run's model is fixed. '' clears a choice back
 * to the default.
 */
export function setTaskRunModel(
  ctx: HarnessContext,
  project: WatchedProject,
  taskId: string,
  choice: AgentRunChoice
): HarnessTask {
  let updated: StoredTask | undefined
  ctx.mutate(project, (state) => {
    const task = state.tasks.find((candidate) => candidate.id === taskId)
    if (!task) throw new Error('Harness task not found')
    if (task.status !== 'pending' || task.claimedBy) {
      throw new Error(t('errors:agentRunModel.runStarted'))
    }
    if (choice.model) task.model = choice.model
    else delete task.model
    if (choice.effort) task.effort = choice.effort
    else delete task.effort
    updated = task
  })
  if (!updated) throw new Error('Harness task update failed')
  ctx.recordEvent(
    project,
    'task_model_changed',
    { id: 'human', title: 'human' },
    `set task ${taskId} model to ${choice.model || 'default'}${choice.effort ? ` (${choice.effort})` : ''}`
  )
  return { ...updated }
}

/**
 * Run playbook (N9.6b): records which playbook a task waiting in the queue
 * came from, so its card and run say so. Changes nothing an agent may do.
 */
export function setTaskPlaybook(
  ctx: HarnessContext,
  project: WatchedProject,
  taskId: string,
  playbook: HarnessTaskPlaybook
): HarnessTask {
  let updated: StoredTask | undefined
  ctx.mutate(project, (state) => {
    const task = state.tasks.find((candidate) => candidate.id === taskId)
    if (!task) throw new Error('Harness task not found')
    task.playbook = { templateId: playbook.templateId, name: playbook.name }
    updated = task
  })
  if (!updated) throw new Error('Harness task update failed')
  return { ...updated }
}

/**
 * Scheduled agent tasks (N9.7): marks a task its repeat's schedule queued,
 * so its queue and run cards say "Scheduled". Changes nothing an agent may do.
 */
export function setTaskScheduled(
  ctx: HarnessContext,
  project: WatchedProject,
  taskId: string
): HarnessTask {
  let updated: StoredTask | undefined
  ctx.mutate(project, (state) => {
    const task = state.tasks.find((candidate) => candidate.id === taskId)
    if (!task) throw new Error('Harness task not found')
    task.scheduled = true
    updated = task
  })
  if (!updated) throw new Error('Harness task update failed')
  return { ...updated }
}

export function updateTask(
  ctx: HarnessContext,
  project: WatchedProject,
  taskId: string,
  action: HarnessTaskAction,
  sessionId: string
): HarnessTask {
  if (!sessionId.trim()) throw new Error('Session ID is required')
  let updated: StoredTask | undefined
  let actor: StoredSession | undefined
  ctx.mutate(project, (state) => {
    updated = state.tasks.find((task) => task.id === taskId)
    if (!updated) throw new Error(`Task ${taskId} not found`)
    if (updated.status === 'cancelled') throw new Error('Cancelled tasks cannot be updated')
    actor = state.sessions.find((session) => session.id === sessionId)
    if (actor) actor.lastSeenAt = new Date().toISOString()
    if (action === 'claim') {
      if (updated.status === 'complete') throw new Error('Completed tasks cannot be claimed')
      if (updated.claimedBy && updated.claimedBy !== sessionId) {
        throw new Error(`Task is already claimed by ${updated.claimedBy}`)
      }
      // An external agent claiming over HTTP is held to the same rule as the
      // embedded runner: queued is not the same as runnable.
      if (
        updated.claimedBy !== sessionId &&
        !ctx.isTaskDispatchable(project.id, updated.planningWorkItemId, sessionId)
      ) {
        throw new Error('This task is still waiting on its dependencies')
      }
      updated.status = 'claimed'
      updated.claimedBy = sessionId
    } else if (action === 'complete') {
      if (updated.claimedBy && updated.claimedBy !== sessionId) {
        throw new Error(`Task is claimed by ${updated.claimedBy}`)
      }
      updated.status = 'complete'
      updated.claimedBy = sessionId
    } else {
      if (updated.claimedBy && updated.claimedBy !== sessionId) {
        throw new Error(`Task is claimed by ${updated.claimedBy}`)
      }
      updated.status = 'pending'
      updated.claimedBy = null
    }
  })
  if (!updated) throw new Error('Task update failed')
  const eventType: HarnessEventType =
    action === 'claim' ? 'task_claimed' : action === 'complete' ? 'task_complete' : 'task_claimed'
  ctx.recordEvent(
    project,
    eventType,
    actor ? { id: actor.id, title: actor.title } : { id: sessionId, title: sessionId },
    `${action} task ${taskId}`
  )
  return updated
}

/** Human queue action: cancel work no agent has taken. Its unused copy is removed by `tidyCopies`. */
export function cancelTask(
  ctx: HarnessContext,
  project: WatchedProject,
  taskId: string,
  planningWorkItemId: string | null = null
): HarnessTask {
  let updated: StoredTask | undefined
  ctx.mutate(project, (state) => {
    updated = state.tasks.find((task) => task.id === taskId)
    if (!updated) throw new Error(`Task ${taskId} not found`)
    if (updated.status !== 'pending') {
      throw new Error('Only a queued task no agent has taken can be cancelled')
    }
    updated.status = 'cancelled'
    updated.claimedBy = null
    if (planningWorkItemId) updated.planningWorkItemId = planningWorkItemId
  })
  if (!updated) throw new Error('Task cancellation failed')
  ctx.recordEvent(
    project,
    'task_cancelled',
    { id: 'human', title: 'human' },
    `cancelled task ${taskId}`
  )
  return updated
}

/** Human queue action: persist the exact order of all queued work. */
export function reorderPendingTasks(
  ctx: HarnessContext,
  project: WatchedProject,
  orderedTaskIds: string[]
): HarnessTask[] {
  if (
    !Array.isArray(orderedTaskIds) ||
    orderedTaskIds.some((taskId) => typeof taskId !== 'string' || !taskId.trim())
  ) {
    throw new Error('Queue order must contain valid task identifiers')
  }
  if (new Set(orderedTaskIds).size !== orderedTaskIds.length) {
    throw new Error('Queue order contains duplicate task identifiers')
  }
  let ordered: StoredTask[] = []
  ctx.mutate(project, (state) => {
    const pending = state.tasks.filter((task) => task.status === 'pending')
    const currentIds = new Set(pending.map((task) => task.id))
    if (
      orderedTaskIds.length !== pending.length ||
      orderedTaskIds.some((taskId) => !currentIds.has(taskId))
    ) {
      throw new Error('Queue order must include every queued task exactly once')
    }
    const byId = new Map(pending.map((task) => [task.id, task]))
    ordered = orderedTaskIds.map((taskId) => byId.get(taskId)!)
    let pendingIndex = 0
    state.tasks = state.tasks.map((task) =>
      task.status === 'pending' ? ordered[pendingIndex++] : task
    )
  })
  ctx.recordEvent(
    project,
    'task_reordered',
    { id: 'human', title: 'human' },
    `reordered ${orderedTaskIds.length} queued tasks`
  )
  return ordered
}

/** Human queue action: adjust scheduling priority without changing execution ownership. */
export function setTaskPriority(
  ctx: HarnessContext,
  project: WatchedProject,
  taskId: string,
  priority: PlanningPriority,
  planningWorkItemId: string | null = null
): HarnessTask {
  const normalized = requireTaskPriority(priority)
  let updated: StoredTask | undefined
  ctx.mutate(project, (state) => {
    updated = state.tasks.find((task) => task.id === taskId)
    if (!updated) throw new Error(`Task ${taskId} not found`)
    if (updated.status === 'cancelled') throw new Error('Cancelled task priority cannot be changed')
    updated.priority = normalized
    if (planningWorkItemId) updated.planningWorkItemId = planningWorkItemId
  })
  if (!updated) throw new Error('Task priority update failed')
  ctx.recordEvent(
    project,
    'task_priority_changed',
    { id: 'human', title: 'human' },
    `set task ${taskId} priority to ${normalized}`
  )
  return updated
}

/**
 * Brings a queued task's text back in line with its work item, which is the
 * source of truth for what the agent is asked to do.
 *
 * A task copies its item's text when it is queued, and that copy is what the
 * agent is handed. Without this, editing a queued item changed the Board and
 * not the work: the agent ran the stale text, and nothing said so. Only work
 * nobody holds is touched; once an agent has a task, its prompt is already
 * written and rewriting the record would misdescribe what it was asked.
 * Returns null when the task is not queued-and-free.
 */
/** How a send-back reason is added to the task details its next agent is handed. */
export function sendBackNote(count: number, reason: string, commentCount = 0): string {
  const comments =
    commentCount > 0 ? ` (${commentCount} line comment${commentCount === 1 ? '' : 's'})` : ''
  return `

[Sent back ${count}] ${reason}${comments}`
}

/** The details of a task: its own text, then every reason it was sent back for. */
export function withSendBackNotes(
  details: string,
  rejections: StoredTask['rejections'] = []
): string {
  const notes = rejections.map((rejection, index) =>
    sendBackNote(
      index + 1,
      rejection.reason,
      rejection.commentCount ?? rejection.comments?.length ?? 0
    )
  )
  return `${details}${notes.join('')}`.slice(0, 8000)
}

export function syncPendingTaskText(
  ctx: HarnessContext,
  project: WatchedProject,
  taskId: string,
  title: string,
  details: string
): HarnessTask | null {
  let updated: StoredTask | undefined
  ctx.mutate(project, (state) => {
    const task = state.tasks.find((candidate) => candidate.id === taskId)
    if (!task || task.status !== 'pending' || task.claimedBy) return
    // The work item's text is the source; the reasons it was sent back for stay
    // on it, or the next agent would never hear why (simplify pass §3.3).
    const composed = withSendBackNotes(details, task.rejections)
    if (task.title === title && task.details === composed) return
    task.title = title
    task.details = composed
    updated = task
  })
  return updated ?? null
}
