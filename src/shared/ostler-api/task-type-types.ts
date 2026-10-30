/**
 * Task types (N2.7a, N22): the kinds of task a project names, such as Bug,
 * Feature and Chore. A task has at most one (`PlanningWorkItem.typeId`).
 * Types are not labels: a task has one type and many labels.
 */
export interface PlanningTaskType {
  id: string
  projectId: string
  name: string
  /** A name from `TASK_TYPE_ICONS` (`src/shared/task-types.ts`), drawn with lucide-react. */
  icon: string
  /** A palette colour, `#rrggbb` (`PROJECT_COLORS`). */
  color: string
  /** Its place in the project's order, from 0. */
  position: number
  /**
   * The custom fields its tasks show (N2.7b), in the project's field order;
   * null shows every field. Values of fields it hides are kept. The service
   * always sets both; a type built elsewhere without them reads as null.
   */
  fieldIds?: string[] | null
  /** The task template (N2.1) new tasks of this type start from, or null. */
  templateId?: string | null
  createdAt: number
  updatedAt: number
}

export interface CreatePlanningTaskTypeInput {
  name: string
  /** Defaults to `circle-dot`. */
  icon?: string
  /** Defaults to a stable palette colour for the name. */
  color?: string
  /** Null or left out: every field. */
  fieldIds?: string[] | null
  templateId?: string | null
}

export type UpdatePlanningTaskTypeInput = Partial<
  Pick<PlanningTaskType, 'name' | 'icon' | 'color' | 'fieldIds' | 'templateId'>
>

/** What deleting a type took away, so Undo can put it and its tasks back. */
export interface PlanningTaskTypeDeletion {
  taskType: PlanningTaskType
  taskIds: string[]
}
