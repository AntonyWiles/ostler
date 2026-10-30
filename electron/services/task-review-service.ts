import { createHash, randomUUID } from 'node:crypto'
import type {
  OstlerConfig,
  PlanningPriority,
  PlanningWorkItem,
  TaskReview,
  WatchedProject
} from '@shared/ostler-api'
import {
  buildTaskReviewUserPrompt,
  buildTaskReviewResolutionUserPrompt,
  OSTLER_AI_REPORTING_SYSTEM_PROMPT
} from '@shared/ostler-api'
import { requireAi, type AiConnection } from './ai-access'
import { MODEL_ANSWER_UNUSABLE, unusableAnswer } from './ai-errors'
import { AIStorageService } from './ai-storage-service'
import type { EventDatabase } from './event-database'
import type { HarnessService } from './harness-service'
import type { PlanningService } from './planning-service'
import { t } from '@shared/i18n'

const EVIDENCE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
const MAX_FORWARD_ITEMS = 50

/**
 * Generates an async, on-demand "AI Task Review" for one planning work item:
 * backward evidence (what happened while the task was worked) and forward
 * evidence (what depends on it downstream), summarized by one JSON-mode LLM
 * call into a diagnosis, an optional follow-up proposal, and a list of
 * downstream effects. Modeled closely on ImprovementReviewService, but scoped
 * to a single work item and stored as append-only history rather than a
 * single latest snapshot.
 */
export class TaskReviewService {
  private readonly storage: AIStorageService
  private running = new Set<string>()

  constructor(
    dataDir: string,
    private readonly database: EventDatabase,
    private readonly planningService: PlanningService,
    private readonly harnessService: HarnessService,
    private readonly getConfig: () => OstlerConfig,
    private readonly onUpdated: (projectId: string) => void
  ) {
    this.storage = new AIStorageService(dataDir)
  }

  getHistory(projectId: string, workItemId: string): TaskReview[] {
    return this.storage.readTaskReviews(projectId, workItemId)
  }

  private getLatest(projectId: string, workItemId: string): TaskReview | null {
    const history = this.getHistory(projectId, workItemId)
    return history.length ? history[history.length - 1] : null
  }

  async refresh(
    project: WatchedProject,
    workItem: PlanningWorkItem,
    _trigger: 'manual' = 'manual'
  ): Promise<TaskReview> {
    const key = `${project.id}:${workItem.id}`
    if (this.running.has(key))
      throw new Error(t('errors:taskReviewService.taskReviewAlreadyRunning'))
    this.running.add(key)
    try {
      // The gate, before any evidence is read: refused while Ostler AI is not set
      // up, or for a project Ostler does not have. There is no per-project switch.
      const ai = requireAi(this.getConfig(), project.id)
      const backward = this.buildBackwardEvidence(project, workItem)
      const forward = this.buildForwardEvidence(project, workItem)
      const evidenceFingerprint = this.fingerprint({ backward, forward })
      const review = await this.generate(
        ai,
        project,
        workItem,
        backward,
        forward,
        evidenceFingerprint
      )
      this.storage.appendTaskReview(project.id, workItem.id, review)
      this.onUpdated(project.id)
      return review
    } finally {
      this.running.delete(key)
    }
  }

  annotate(
    projectId: string,
    workItemId: string,
    reviewId: string,
    humanComment: string
  ): TaskReview {
    const review = this.requireReview(projectId, workItemId, reviewId)
    review.humanComment = humanComment.trim().slice(0, 4000)
    this.storage.updateTaskReview(projectId, workItemId, review)
    this.onUpdated(projectId)
    return review
  }

  dismiss(projectId: string, workItemId: string, reviewId: string): TaskReview {
    const review = this.requireReview(projectId, workItemId, reviewId)
    review.status = 'dismissed'
    this.storage.updateTaskReview(projectId, workItemId, review)
    this.onUpdated(projectId)
    return review
  }

  /**
   * Human-confirmed accept: creates a new work item from the review's
   * proposal. The renderer is responsible for showing a preview/confirmation
   * before calling this - by the time this runs, the create is final (an
   * "undo" delete is a separate, explicit follow-up action from the UI).
   */
  accept(
    projectId: string,
    workItemId: string,
    reviewId: string
  ): { review: TaskReview; createdWorkItem: PlanningWorkItem } {
    const review = this.requireReview(projectId, workItemId, reviewId)
    if (!review.proposal) throw new Error(t('errors:taskReviewService.reviewHasNoProposal'))
    if (review.status === 'accepted' && review.createdWorkItemId) {
      const existing = this.planningService.getWorkItem(review.createdWorkItemId)
      return { review, createdWorkItem: existing }
    }
    const source = this.planningService.getWorkItem(workItemId)
    const createdWorkItem = this.planningService.createWorkItem(
      projectId,
      {
        title: review.proposal.title,
        description: review.proposal.description,
        priority: review.proposal.priority,
        acceptanceCriteria: review.proposal.acceptanceCriteria,
        milestoneId: source.milestoneId,
        dependencyIds: [workItemId]
      },
      { ...this.planningService.humanActor(), draftId: reviewId },
      'ai-approved'
    )
    review.status = 'accepted'
    review.createdWorkItemId = createdWorkItem.id
    this.storage.updateTaskReview(projectId, workItemId, review)
    this.onUpdated(projectId)
    return { review, createdWorkItem }
  }

  /**
   * Human-confirmed: has the AI draft a single new work item aimed at
   * resolving this review's diagnosis and downstream effects (optionally
   * folding in the human's own comment) and creates it, marking the review
   * accepted. Queuing the created task for the harness is the caller's
   * responsibility.
   */
  async resolve(
    projectId: string,
    workItemId: string,
    reviewId: string,
    includeComment: boolean
  ): Promise<{ review: TaskReview; createdWorkItem: PlanningWorkItem }> {
    // The gate first, before anything is read: refused while Ostler AI is not set
    // up, or for a project Ostler does not have. There is no per-project switch.
    const config = this.getConfig()
    const { provider, model } = requireAi(config, projectId)
    const review = this.requireReview(projectId, workItemId, reviewId)
    if (review.status === 'accepted' && review.createdWorkItemId) {
      const existing = this.planningService.getWorkItem(review.createdWorkItemId)
      return { review, createdWorkItem: existing }
    }

    const source = this.planningService.getWorkItem(workItemId)

    const evidence = {
      taskTitle: source.title,
      diagnosis: review.diagnosis,
      downstreamEffects: review.downstreamEffects,
      humanNotes: includeComment && review.humanComment ? review.humanComment : null
    }
    const prompt = buildTaskReviewResolutionUserPrompt(evidence)

    let response = ''
    for await (const chunk of provider.chat(
      [
        { role: 'system', content: OSTLER_AI_REPORTING_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      {
        model,
        maxTokens: config.ai.maxTokens || 4096,
        temperature: 0.2,
        stream: true
      }
    )) {
      response += chunk
    }

    const proposal = this.parseResolutionProposal(response)
    const createdWorkItem = this.planningService.createWorkItem(
      projectId,
      {
        title: proposal.title,
        description: proposal.description,
        priority: proposal.priority,
        acceptanceCriteria: proposal.acceptanceCriteria,
        milestoneId: source.milestoneId,
        // No dependencyIds: unlike accept()'s created work item (left in the
        // backlog for a human to queue later), this one is queued
        // immediately below -- it must not depend on the very task it exists
        // to resolve, which is what's stalled in the first place.
        status: 'ready'
      },
      { ...this.planningService.humanActor(), draftId: reviewId },
      'ai-approved'
    )

    review.status = 'accepted'
    review.createdWorkItemId = createdWorkItem.id
    this.storage.updateTaskReview(projectId, workItemId, review)
    this.onUpdated(projectId)
    return { review, createdWorkItem }
  }

  private parseResolutionProposal(response: string): {
    title: string
    description: string
    priority: PlanningPriority
    acceptanceCriteria: string[]
  } {
    const json = response
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(json)
    } catch {
      throw unusableAnswer('The follow-up task was not valid JSON.')
    }
    const title = this.shortText(parsed.title, 140)
    const description = this.shortText(parsed.description, 2000)
    const priority =
      parsed.priority === 'low' ||
      parsed.priority === 'medium' ||
      parsed.priority === 'high' ||
      parsed.priority === 'critical'
        ? parsed.priority
        : 'medium'
    const acceptanceCriteria = Array.isArray(parsed.acceptanceCriteria)
      ? parsed.acceptanceCriteria
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.slice(0, 500))
          .slice(0, 30)
      : []
    if (!title || !description) throw new Error('AI returned an incomplete task format.')
    return { title, description, priority, acceptanceCriteria }
  }

  private requireReview(projectId: string, workItemId: string, reviewId: string): TaskReview {
    const review = this.getHistory(projectId, workItemId).find((item) => item.id === reviewId)
    if (!review) throw new Error('Task review not found')
    return review
  }

  /**
   * Everything that touched this task. There is no direct task-level foreign
   * key on watch/git/harness events in EventDatabase, so - like
   * ImprovementReviewService - this falls back to the project-scoped recent
   * activity within the evidence window, plus git log for the task's linked
   * harness session branch when one exists.
   */
  private buildBackwardEvidence(
    project: WatchedProject,
    workItem: PlanningWorkItem
  ): Record<string, unknown> {
    const since = Date.now() - EVIDENCE_WINDOW_MS
    const watchEvents = this.database
      .getRecentEvents({ projectId: project.id, since, limit: 100 })
      .map(({ type, relativePath, category, sizeBytes, timestamp }) => ({
        type,
        relativePath,
        category,
        sizeBytes,
        timestamp
      }))
    const gitEvents = this.database.getGitEvents(project.id, 30)
    const conversations = this.database
      .getConversations()
      .filter((conversation) => conversation.projectId === project.id)
      .slice(0, 10)
      .map(({ id, timestamp, title, messages }) => ({
        id,
        timestamp,
        title,
        messageCount: messages.length
      }))

    let branchCommits: unknown[] = []
    let branchNote =
      'This task has no linked harness session, so no branch-scoped git log is available.'
    const session = this.findSessionForWorkItem(project, workItem)
    if (session?.workspace) {
      branchNote = `Branch-scoped git log for session workspace ${session.workspace.branchName} is not separately tracked; showing project-scoped git log above instead.`
      branchCommits = gitEvents
    }

    return {
      taskTitle: workItem.title,
      taskDescription: workItem.description,
      taskStatus: workItem.status,
      verificationStatus: workItem.verificationStatus,
      windowStart: new Date(since).toISOString(),
      projectScopedWatchEvents: watchEvents,
      projectScopedGitCommits: gitEvents.map(
        ({ hash, message, author, date, filesChanged, insertions, deletions }) => ({
          hash,
          message,
          author,
          date,
          filesChanged,
          insertions,
          deletions
        })
      ),
      projectScopedConversations: conversations,
      linkedHarnessSessionBranch: session?.workspace?.branchName ?? null,
      linkedHarnessSessionBaseBranch: session?.workspace?.baseBranch ?? null,
      branchCommits,
      branchNote
    }
  }

  /** Downstream work items (transitive dependents/descendants) and any child harness sessions branched off this task's session. */
  private buildForwardEvidence(
    project: WatchedProject,
    workItem: PlanningWorkItem
  ): Record<string, unknown> {
    const allItems = this.planningService.listWorkItems(project.id)
    const downstream = this.collectDownstream(workItem.id, allItems)

    let childSessions: { sessionId: string; branchName: string }[] = []
    const session = this.findSessionForWorkItem(project, workItem)
    if (session?.workspace) {
      const state = this.harnessService.getState(project)
      const allSessions = [...state.activeSessions, ...state.reviewSessions]
      childSessions = allSessions
        .filter((candidate) => candidate.workspace?.baseBranch === session.workspace!.branchName)
        .map((candidate) => ({
          sessionId: candidate.id,
          branchName: candidate.workspace!.branchName
        }))
    }

    return {
      downstreamWorkItems: downstream.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        relationship: item.relationship
      })),
      childHarnessSessions: childSessions
    }
  }

  private collectDownstream(
    workItemId: string,
    allItems: PlanningWorkItem[]
  ): Array<{
    id: string
    title: string
    status: string
    relationship: 'dependent' | 'descendant'
  }> {
    const byId = new Map(allItems.map((item) => [item.id, item]))
    const result = new Map<
      string,
      { id: string; title: string; status: string; relationship: 'dependent' | 'descendant' }
    >()
    const queue: Array<{ id: string; relationship: 'dependent' | 'descendant' }> = []

    for (const item of allItems) {
      if (item.dependencyIds.includes(workItemId))
        queue.push({ id: item.id, relationship: 'dependent' })
      if (item.parentWorkItemId === workItemId)
        queue.push({ id: item.id, relationship: 'descendant' })
    }

    while (queue.length && result.size < MAX_FORWARD_ITEMS) {
      const next = queue.shift()!
      if (result.has(next.id)) continue
      const item = byId.get(next.id)
      if (!item) continue
      result.set(next.id, {
        id: item.id,
        title: item.title,
        status: item.status,
        relationship: next.relationship
      })
      for (const candidate of allItems) {
        if (candidate.dependencyIds.includes(next.id) && !result.has(candidate.id)) {
          queue.push({ id: candidate.id, relationship: 'dependent' })
        }
        if (candidate.parentWorkItemId === next.id && !result.has(candidate.id)) {
          queue.push({ id: candidate.id, relationship: 'descendant' })
        }
      }
    }
    return [...result.values()]
  }

  /** Best-effort: resolves the harness session that claimed this task's linked harness task, if any. */
  private findSessionForWorkItem(
    project: WatchedProject,
    workItem: PlanningWorkItem
  ): ReturnType<HarnessService['getState']>['activeSessions'][number] | null {
    if (!workItem.linkedHarnessTaskId) return null
    const state = this.harnessService.getState(project)
    const task = state.taskQueue.find((candidate) => candidate.id === workItem.linkedHarnessTaskId)
    if (!task?.claimedBy) return null
    const allSessions = [...state.activeSessions, ...state.reviewSessions]
    return allSessions.find((session) => session.id === task.claimedBy) ?? null
  }

  private async generate(
    { provider, model }: AiConnection,
    project: WatchedProject,
    workItem: PlanningWorkItem,
    backward: Record<string, unknown>,
    forward: Record<string, unknown>,
    evidenceFingerprint: string
  ): Promise<TaskReview> {
    const now = new Date().toISOString()
    const config = this.getConfig()

    const evidence = { backward, forward, generatedAt: now }
    const prompt = buildTaskReviewUserPrompt(evidence)

    try {
      let response = ''
      for await (const chunk of provider.chat(
        [
          { role: 'system', content: OSTLER_AI_REPORTING_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        {
          model,
          maxTokens: config.ai.maxTokens || 4096,
          temperature: 0.2,
          stream: true
        }
      )) {
        response += chunk
      }
      return this.parseReview(workItem, project.id, now, evidenceFingerprint, response, forward)
    } catch (error) {
      return this.errorReview(
        workItem,
        project.id,
        now,
        evidenceFingerprint,
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  private parseReview(
    workItem: PlanningWorkItem,
    projectId: string,
    generatedAt: string,
    evidenceFingerprint: string,
    response: string,
    forward: Record<string, unknown>
  ): TaskReview {
    const json = response
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
    let parsed: {
      diagnosis?: unknown
      proposal?: unknown
      downstreamEffects?: unknown
    }
    try {
      parsed = JSON.parse(json)
    } catch {
      return this.errorReview(
        workItem,
        projectId,
        generatedAt,
        evidenceFingerprint,
        MODEL_ANSWER_UNUSABLE
      )
    }
    if (typeof parsed.diagnosis !== 'string') {
      return this.errorReview(
        workItem,
        projectId,
        generatedAt,
        evidenceFingerprint,
        MODEL_ANSWER_UNUSABLE
      )
    }

    const knownDownstreamIds = new Set(
      ((forward.downstreamWorkItems as Array<{ id: string }>) ?? []).map((item) => item.id)
    )

    let proposal: TaskReview['proposal'] = null
    if (parsed.proposal && typeof parsed.proposal === 'object') {
      const candidate = parsed.proposal as Record<string, unknown>
      const title = this.shortText(candidate.title, 140)
      const description = this.shortText(candidate.description, 2000)
      const priority =
        candidate.priority === 'low' ||
        candidate.priority === 'medium' ||
        candidate.priority === 'high' ||
        candidate.priority === 'critical'
          ? candidate.priority
          : 'medium'
      const acceptanceCriteria = Array.isArray(candidate.acceptanceCriteria)
        ? candidate.acceptanceCriteria
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.slice(0, 500))
            .slice(0, 30)
        : []
      if (title && description) {
        proposal = { title, description, priority, acceptanceCriteria }
      }
    }

    const downstreamEffects = Array.isArray(parsed.downstreamEffects)
      ? parsed.downstreamEffects
          .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
          .filter(
            (item) => typeof item.workItemId === 'string' && knownDownstreamIds.has(item.workItemId)
          )
          .map((item) => ({
            workItemId: item.workItemId as string,
            workItemTitle: this.shortText(item.workItemTitle, 200),
            impact: this.shortText(item.impact, 1000)
          }))
          .slice(0, MAX_FORWARD_ITEMS)
      : []

    return {
      id: randomUUID(),
      workItemId: workItem.id,
      projectId,
      generatedAt,
      evidenceFingerprint,
      diagnosis: parsed.diagnosis.slice(0, 4000),
      proposal,
      downstreamEffects,
      status: 'open',
      humanComment: '',
      error: null
    }
  }

  private errorReview(
    workItem: PlanningWorkItem,
    projectId: string,
    generatedAt: string,
    evidenceFingerprint: string,
    error: string
  ): TaskReview {
    return {
      id: randomUUID(),
      workItemId: workItem.id,
      projectId,
      generatedAt,
      evidenceFingerprint,
      diagnosis: t('errors:taskReviewService.ostlerCouldNotGenerate'),
      proposal: null,
      downstreamEffects: [],
      status: 'open',
      humanComment: '',
      error
    }
  }

  private shortText(value: unknown, maximum: number): string {
    return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
  }

  private fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex')
  }
}
