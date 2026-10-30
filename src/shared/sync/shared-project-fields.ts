/**
 * The project settings every member of a shared project has in common
 * (electron/services/sync/records.ts): they travel in its snapshots and settings records.
 * Only an Owner or an Editor changes them (D1); on a Viewer's PC they are read-only.
 * The project's folder, area, stage and the rest stay each PC's own.
 */
export const SHARED_PROJECT_FIELDS = [
  'name',
  'color',
  'notes',
  'tags',
  'taskPrefix',
  'icon'
] as const

export type SharedProjectField = (typeof SHARED_PROJECT_FIELDS)[number]
