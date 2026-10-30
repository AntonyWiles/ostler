import type { PlanningTaskType } from './ostler-api/task-type-types'

/** The most types a project may have. */
export const MAX_TASK_TYPES = 20

/** The longest a type's name may be. */
export const MAX_TASK_TYPE_NAME_LENGTH = 40

/** The icon a type gets when none is chosen. */
export const DEFAULT_TASK_TYPE_ICON = 'circle-dot'

/**
 * The curated icons a type may have (D9: lucide-react only), by lucide's
 * file name. Main validates against this list; the renderer draws each with
 * the component `src/renderer/ui/task-type-icons.ts` maps it to.
 */
export const TASK_TYPE_ICONS = [
  'circle-dot',
  'bug',
  'sparkles',
  'wrench',
  'hammer',
  'clipboard-list',
  'list-checks',
  'lightbulb',
  'rocket',
  'flag',
  'star',
  'heart',
  'zap',
  'flame',
  'shield',
  'lock',
  'search',
  'gauge',
  'test-tube',
  'code',
  'terminal',
  'server',
  'file-text',
  'book-open',
  'pen-tool',
  'paintbrush',
  'palette',
  'phone',
  'mail',
  'message-square',
  'calendar',
  'shopping-cart',
  'wallet',
  'house',
  'car',
  'truck',
  'plane',
  'package',
  'leaf',
  'graduation-cap'
] as const

export type TaskTypeIcon = (typeof TASK_TYPE_ICONS)[number]

export function isTaskTypeIcon(value: unknown): value is TaskTypeIcon {
  return typeof value === 'string' && (TASK_TYPE_ICONS as readonly string[]).includes(value)
}

/** Types in the project's order. */
export function sortTaskTypes<T extends Pick<PlanningTaskType, 'position' | 'name'>>(
  types: readonly T[]
): T[] {
  return [...types].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
}

/** The type with this name, ignoring case and surrounding spaces, if there is one. */
export function taskTypeByName<T extends Pick<PlanningTaskType, 'name'>>(
  types: readonly T[],
  name: string
): T | undefined {
  const key = name.trim().toLocaleLowerCase()
  if (!key) return undefined
  return types.find((type) => type.name.toLocaleLowerCase() === key)
}

/** A type's name by id, or null for none or a type that is gone. */
export function taskTypeName(
  types: readonly Pick<PlanningTaskType, 'id' | 'name'>[],
  typeId: string | null | undefined
): string | null {
  if (!typeId) return null
  return types.find((type) => type.id === typeId)?.name ?? null
}
