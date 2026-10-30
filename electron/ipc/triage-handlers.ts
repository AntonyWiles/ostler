import { type LibraryItem, type TriageList, type WatchedProject } from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import type { AIPlanningService } from '../services/ai-planning-service'
import type { LibraryService } from '../services/library-service'
import type { PlanningService } from '../services/planning-service'
import {
  acceptAllFromTriage,
  acceptFromTriage,
  moveFromTriage,
  readAcceptFields,
  undoTriageMove
} from '../services/triage-service'
import { projectIpcHandlers, handleApi } from './handle-ipc'
import { triageSuggestionInput } from './triage-suggest-input'

export interface TriageHandlerDependencies {
  planningService: PlanningService
  libraryService: LibraryService | null
  aiPlanningService: AIPlanningService
  getProject(projectId: string): WatchedProject
  notifyHarnessState(project: WatchedProject): void
}

/**
 * Triage (N4.3a): Accept, Accept all and Move to project. Someday, Won't do
 * and Duplicate of use their own channels, which clear the mark too. Suggest
 * (N4.3b) asks Ostler AI and saves nothing; it is not in the automation API.
 */
export function registerTriageHandlers({
  planningService,
  libraryService,
  aiPlanningService,
  getProject,
  notifyHarnessState
}: TriageHandlerDependencies): void {
  const { projectApi } = projectIpcHandlers(getProject, notifyHarnessState)
  const human = () => planningService.humanActor()
  const id = (value: unknown, label: string): string => {
    if (typeof value !== 'string' || !value) throw new Refusal(`Send a ${label}`)
    return value
  }

  projectApi('acceptTriagedWorkItem', (project, workItemId: unknown, fields: unknown) =>
    acceptFromTriage(
      planningService,
      project,
      id(workItemId, 'task id'),
      readAcceptFields(fields),
      human()
    )
  )
  projectApi('acceptAllTriagedWorkItems', (project) =>
    acceptAllFromTriage(planningService, project, human())
  )
  projectApi('moveTriagedWorkItem', (project, workItemId: unknown, toProjectId: unknown) =>
    moveFromTriage(
      { planning: planningService, library: libraryService },
      project,
      id(workItemId, 'task id'),
      getProject(id(toProjectId, 'project id')),
      human()
    )
  )
  projectApi('undoTriageMove', (project, move: unknown) => {
    if (!move || typeof move !== 'object') throw new Refusal('Send the move to undo')
    const { workItem, movedFromId, copiedItemIds } = move as Record<string, unknown>
    const made = workItem && typeof workItem === 'object' ? (workItem as { id?: unknown }).id : null
    return undoTriageMove(
      { planning: planningService, library: libraryService },
      project,
      {
        workItemId: id(made, 'moved task id'),
        movedFromId: id(movedFromId, 'original task id'),
        copiedItemIds: Array.isArray(copiedItemIds)
          ? copiedItemIds.filter((entry): entry is string => typeof entry === 'string')
          : []
      },
      human()
    )
  })
  projectApi('getTriage', (project): TriageList => {
    const items = planningService.listWorkItems(project.id, 'triage')
    const pictures: Record<string, LibraryItem> = {}
    // Read in main, in this one call: a capture's picture is its thumbnail.
    for (const item of items) {
      const picture = libraryService
        ?.listWorkItemAttachments(project.id, item.id)
        .find((attachment) => attachment.item.kind === 'image' && attachment.item.file)
      if (picture) pictures[item.id] = picture.item
    }
    return { items, pictures }
  })
  handleApi('getProjectUsage', () => planningService.listProjectUsage())
  // Suggest (N4.3b): the gate comes first; the task, its labels and the
  // search candidates are read after it. Nothing is saved.
  projectApi('suggestTriage', (project, workItemId: unknown) => {
    const taskId = id(workItemId, 'task id')
    return aiPlanningService.suggestForTriage(project.id, () =>
      triageSuggestionInput(planningService, project, taskId)
    )
  })
}
