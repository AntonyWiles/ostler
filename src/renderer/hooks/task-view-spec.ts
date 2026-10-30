/**
 * How a task view reads its own options from a saved view (P5.7). Kept apart
 * from `useTaskView` so a view's settings module, and its unit tests, need
 * nothing from React.
 */
export interface TaskViewSpec<O extends object> {
  /** Options made safe from stored (or missing) input. */
  normalize: (raw: unknown) => O
  /** The pre-P5.7 localStorage key holding `{ version: 1, projects: { [id]: options } }`. */
  legacyKey?: string
}
