import { ADVANCED_DEMO_TEMPLATE_ID, SAMPLE_TEMPLATE_ID } from '@shared/ostler-api'
import type { DemoKind, RendererProject, Result } from '@shared/ostler-api'
import { demoProjectName } from '@shared/templates/template-text'

export type { DemoKind }

/**
 * The two demo projects, always added together: the simple one, a weekend
 * away (the sample project, P5.8, where the tips and walkthrough run), and
 * the advanced one, a café refit with the features and settings the simple
 * one leaves out. Each is made in the language shown (`demoProjectName`).
 */
export const DEMO_PROJECTS: Record<DemoKind, { templateId: string }> = {
  simple: { templateId: SAMPLE_TEMPLATE_ID },
  advanced: { templateId: ADVANCED_DEMO_TEMPLATE_ID }
}

export const DEMO_KINDS = Object.keys(DEMO_PROJECTS) as DemoKind[]

/**
 * A demo project is one main marked when it made it from the demo's package
 * (`demo`), whatever it is called now; archived, it is no longer offered.
 * Leave `kind` out for either demo.
 */
export function isDemoProject(
  project: Pick<RendererProject, 'enabled' | 'demo'>,
  kind?: DemoKind
): boolean {
  return project.enabled && !!project.demo && (kind === undefined || project.demo === kind)
}

/** The sample project (P5.8): the simple demo. */
export function isSampleProject(project: Pick<RendererProject, 'enabled' | 'demo'>): boolean {
  return isDemoProject(project, 'simple')
}

/**
 * Adds whichever demo projects `projects` lacks, from their built-in
 * packages, with no folder; returns both, by kind. The one way demos are
 * made: the welcome, New project, Home and the command palette all add both.
 */
export async function addDemoProjects(
  projects: readonly RendererProject[]
): Promise<Result<Record<DemoKind, RendererProject>>> {
  const made: Partial<Record<DemoKind, RendererProject>> = {}
  for (const kind of DEMO_KINDS) {
    const existing = projects.find((project) => isDemoProject(project, kind))
    if (existing) {
      made[kind] = existing
      continue
    }
    const result = await window.ostlerAPI.createProject({
      name: demoProjectName(kind),
      color: '',
      tags: [],
      notes: '',
      folder: null,
      templateId: DEMO_PROJECTS[kind].templateId
    })
    if (!result.ok) return result
    made[kind] = result.value.project
  }
  return { ok: true, value: made as Record<DemoKind, RendererProject> }
}
