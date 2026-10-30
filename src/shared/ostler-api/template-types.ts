import type { TemplateIcon } from '../project-package'
import type { DemoKind } from './project-types'

// ─── Templates and the sample project (P5.8) ────────────────────────────────

/** The id of the built-in sample project, "Welcome to Ostler": the simple demo, a weekend away. */
export const SAMPLE_TEMPLATE_ID = 'sample'
/** The id of the advanced demo, a café refit: the features and settings the sample leaves out. */
export const ADVANCED_DEMO_TEMPLATE_ID = 'demo-advanced'
/** The demo projects: offered as demos of their own, never in the template picker. */
export const DEMO_TEMPLATE_IDS: readonly string[] = [SAMPLE_TEMPLATE_ID, ADVANCED_DEMO_TEMPLATE_ID]
/** Which demo each demo template makes; any other template makes no demo. */
export const DEMO_KIND_BY_TEMPLATE: Readonly<Record<string, DemoKind>> = {
  [SAMPLE_TEMPLATE_ID]: 'simple',
  [ADVANCED_DEMO_TEMPLATE_ID]: 'advanced'
}
/** The id of the built-in empty template; the wizard offers it as "Blank". */
export const BLANK_TEMPLATE_ID = 'blank'

/**
 * A template as the picker and Settings › Projects show it. Built-in ones
 * ship with the app (`src/shared/templates/`); saved ones live in
 * `<dataDir>/templates/`.
 */
export interface ProjectTemplateSummary {
  id: string
  source: 'built-in' | 'saved'
  name: string
  description: string
  icon: TemplateIcon
  milestoneCount: number
  taskCount: number
  /** The first few top-level tasks, in order. */
  firstTasks: string[]
}

/** What "Save as template…" may carry. Comments, activity and agent links never travel. */
export interface ProjectPackageInclude {
  /** Tasks, with their subtasks, checklists, dependencies and repeats. */
  tasks?: boolean
  /** Goals and milestones. */
  milestones?: boolean
  labels?: boolean
  /** The people tasks are assigned to (by name). */
  people?: boolean
  decisions?: boolean
  /** Briefs, guides, notes and links (never files). */
  library?: boolean
  /** The project's own task templates (N2.1); on unless turned off. */
  taskTemplates?: boolean
  /** Only in a full export (P6.1); a template never carries them. */
  comments?: boolean
}

export interface SaveProjectTemplateInput {
  name: string
  description?: string
  include?: ProjectPackageInclude
  /** Turn dates into offsets from today, so the template's plan starts when it is used. */
  relativeDates?: boolean
}
