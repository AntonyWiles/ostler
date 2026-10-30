import type { RendererProject, SavedViewConfig } from '@shared/ostler-api'
import type { PlanningWorkspace } from '../hooks/usePlanningWorkspace'
import type { ViewContext } from './registry'

/** What every project view receives from the workspace. */
export interface ProjectViewProps {
  project: RendererProject
  /** The project's planning workspace, shared by every view and dialog. */
  ws: PlanningWorkspace
  features: ViewContext
  /** AI task suggestions; the review dialog belongs to the workspace. */
  suggestTasks: { busy: boolean; start: () => void }
  /** A view tells the workspace what it shows, for Print and Export (P6.1); null when it goes. */
  reportView?: (output: ViewOutput | null) => void
  /** Edit in Excel (N2.8): the List's rows, as the workspace's menu offers it. */
  editInExcel?: () => void
}

/** What a view shows now: its filter, search and options, and for the List its rows and columns. */
export interface ViewOutput {
  config: SavedViewConfig
  /** The List's tasks, in the order shown (collapsed groups and subtasks included). */
  taskIds?: string[]
  /** The List's visible columns, in order. */
  columns?: string[]
  /** The Timeline's range (N7.6), first and last day. */
  range?: { start: string; end: string }
}
