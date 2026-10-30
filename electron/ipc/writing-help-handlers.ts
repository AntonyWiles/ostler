import { MAX_COMMENT_LENGTH } from '@shared/ostler-api'
import type { PlanningComment, WatchedProject } from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { t } from '@shared/i18n'
import type { CommentSummary, ImprovedWriting, ImproveWritingRequest } from '@shared/writing-help'
import type { PolishedReleaseNotes, PolishReleaseNotesRequest } from '@shared/release-notes'
import { checkReleaseNotesOptions, releaseNotesFor } from '../services/release-notes-service'
import type { AIPlanningService } from '../services/ai-planning-service'
import type { PeopleService } from '../services/people-service'
import type { PlanningService } from '../services/planning-service'
import { handleApi } from './handle-ipc'

export interface WritingHelpHandlerDependencies {
  aiPlanningService: AIPlanningService
  planningService: PlanningService
  peopleService: PeopleService
  getProject(projectId: string): WatchedProject
  notifyPlanningChanged(project: WatchedProject): void
}

/** The name a comment's author goes by in a summary request. */
function commentAuthorName(comment: PlanningComment, peopleService: PeopleService): string {
  switch (comment.authorKind) {
    case 'human':
      if (comment.authorPersonId) {
        try {
          return peopleService.get(comment.authorPersonId).name
        } catch {
          return 'Someone'
        }
      }
      return 'Someone'
    case 'ostler-ai':
      return BRAND.aiName
    case 'automation':
      return 'Automation API'
    case 'agent':
      return 'Coding agent'
    case 'rule':
      return comment.ruleName ? `Rule ${comment.ruleName}` : 'Rule'
    default:
      return 'Someone'
  }
}

/**
 * Summarise comments' request: the task's comments with their authors' names
 * and dates, and nothing else. Shared by the handler and its tests.
 */
export function summaryComments(
  planningService: PlanningService,
  peopleService: PeopleService,
  workItemId: string
): Array<{ author: string; at: number; body: string }> {
  return planningService.listComments(workItemId).map((comment) => ({
    author: commentAuthorName(comment, peopleService),
    at: comment.createdAt,
    body: comment.body
  }))
}

/**
 * Adds a summary the person chose to keep as a comment by Ostler AI. Undo is
 * the ordinary comment delete. Shared by the handler and its tests.
 */
export function addSummaryComment(
  planningService: PlanningService,
  workItemId: string,
  summary: unknown
): PlanningComment {
  if (typeof summary !== 'string' || !summary.trim()) {
    throw new Error(t('errors:writingHelp.summaryEmpty'))
  }
  return planningService.addComment(workItemId, summary.trim().slice(0, MAX_COMMENT_LENGTH), {
    kind: 'ostler-ai'
  })
}

/**
 * Writing help and summaries (N8.2). Improving and summarising send text
 * through Ostler AI and create nothing; adding a summary writes one comment.
 * Not in the automation API: Ostler AI features are not there, and an external
 * agent writes with its own model.
 */
export function registerWritingHelpHandlers({
  aiPlanningService,
  planningService,
  peopleService,
  getProject,
  notifyPlanningChanged
}: WritingHelpHandlerDependencies): void {
  handleApi(
    'improveWriting',
    async (_event, projectId: string, request: ImproveWritingRequest): Promise<ImprovedWriting> => {
      const project = getProject(projectId)
      const target = request?.target
      let libraryItemId: string | undefined
      if (
        target?.kind === 'library' &&
        (target.itemId === null || typeof target.itemId === 'string')
      ) {
        libraryItemId = target.itemId ?? undefined
      } else if (target?.kind === 'task' && typeof target.workItemId === 'string') {
        if (planningService.getWorkItem(target.workItemId).projectId !== project.id) {
          throw new Error('That task belongs to a different project.')
        }
      } else if (target?.kind === 'decision' && typeof target.decisionId === 'string') {
        if (planningService.getDecision(target.decisionId).projectId !== project.id) {
          throw new Error('That decision belongs to a different project.')
        }
      } else {
        throw new Error('Unknown text box.')
      }
      return await aiPlanningService.improveWriting(project.id, project.name, {
        style: request.style,
        text: request.text,
        ...(libraryItemId !== undefined ? { libraryItemId } : {})
      })
    }
  )

  // Polish with AI (N9.9): main builds the draft from the milestone or
  // iteration itself, so nothing but that draft can reach the model.
  handleApi(
    'polishReleaseNotes',
    async (
      _event,
      projectId: string,
      request: PolishReleaseNotesRequest
    ): Promise<PolishedReleaseNotes> => {
      const project = getProject(projectId)
      const source = request?.source
      if (
        (source?.kind !== 'milestone' && source?.kind !== 'iteration') ||
        typeof source.id !== 'string'
      ) {
        throw new Error('Release notes are for a milestone or an iteration.')
      }
      const options = checkReleaseNotesOptions(request.options)
      return await aiPlanningService.polishReleaseNotes(project.id, () =>
        releaseNotesFor(planningService, project.id, { kind: source.kind, id: source.id }, options)
      )
    }
  )

  handleApi(
    'summariseComments',
    async (_event, projectId: string, workItemId: string): Promise<CommentSummary> => {
      const project = getProject(projectId)
      const item = planningService.getWorkItem(workItemId)
      if (item.projectId !== project.id) {
        throw new Error('That task belongs to a different project.')
      }
      return await aiPlanningService.summariseComments(
        project.id,
        { id: item.id, title: item.title },
        summaryComments(planningService, peopleService, item.id)
      )
    }
  )

  handleApi(
    'addCommentSummary',
    async (_event, projectId: string, workItemId: string, summary: string) => {
      const project = getProject(projectId)
      const item = planningService.getWorkItem(workItemId)
      if (item.projectId !== project.id) {
        throw new Error('That task belongs to a different project.')
      }
      const comment = addSummaryComment(planningService, item.id, summary)
      notifyPlanningChanged(project)
      return comment
    }
  )
}
