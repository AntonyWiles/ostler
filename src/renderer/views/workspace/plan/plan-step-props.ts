import type { RendererProject } from '@shared/ostler-api'
import type { PlanProgress } from '@shared/planning/plan-steps'
import type { PlanningWorkspace } from '../../../hooks/usePlanningWorkspace'
import type { ViewContext } from '../../../navigation/registry'
import type { PlanPeople } from './usePlanPeople'

/** What each step's pane on the Plan page receives. */
export interface PlanStepProps {
  project: RendererProject
  ws: PlanningWorkspace
  features: ViewContext
  suggestTasks: { busy: boolean; start: () => void }
  progress: PlanProgress
  /** Who has too much work; null while the People step is not shown. */
  people: PlanPeople | null
}
