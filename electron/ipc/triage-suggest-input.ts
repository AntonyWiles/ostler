import type { WatchedProject } from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import type { TriageCandidate } from '@shared/triage-suggestions'
import type { PlanningService } from '../services/planning-service'
import { triageCandidates } from '../services/triage-candidates'

/**
 * What a triage suggestion (N4.3b) is built from, read in main: the waiting
 * task's title and description, the project's label names and the candidates
 * Ostler's search found. Shared by the handler and its tests.
 */
export function triageSuggestionInput(
  planningService: PlanningService,
  project: WatchedProject,
  workItemId: string
): {
  workItemId: string
  item: { title: string; description: string }
  labels: string[]
  candidates: TriageCandidate[]
} {
  const item = planningService.getWorkItem(workItemId)
  if (item.projectId !== project.id) throw new Refusal('That task belongs to a different project.')
  if (!item.inTriage) throw new Refusal(t('errors:triageSuggestions.notInTriage'))
  return {
    workItemId: item.id,
    item: { title: item.title, description: item.description },
    labels: planningService.listProjectLabels(project.id).map((label) => label.name),
    candidates: triageCandidates(planningService, item)
  }
}
