/**
 * Areas (N5.1, N36): named groups of projects, such as Home, Work and Side
 * projects. They live in `config.areas`, in their order; a project names its
 * area with `WatchedProject.areaId`. A project is in one area or none.
 *
 * `groupProjectsByArea` is the one grouping: the sidebar, Home's project cards
 * and every project picker use it, so they always agree.
 */

export interface ProjectArea {
  id: string
  /** Up to `MAX_AREA_NAME_LENGTH` characters. */
  name: string
}

export const MAX_AREA_NAME_LENGTH = 40

/** One heading's worth of projects. `area` null is "No area". */
export interface ProjectAreaGroup<T> {
  area: ProjectArea | null
  projects: T[]
}

/** An area name as saved: trimmed, at most 40 characters, never empty (throws). */
export function normalizeAreaName(name: unknown): string {
  if (typeof name !== 'string') throw new Error('An area name is text')
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Give the area a name')
  if (trimmed.length > MAX_AREA_NAME_LENGTH) {
    throw new Error(`An area name can be at most ${MAX_AREA_NAME_LENGTH} characters`)
  }
  return trimmed
}

/**
 * The saved list of areas from anything: entries that are not an area are
 * dropped, a repeated id keeps its first place, names are trimmed and cut to
 * 40 characters. Used when config is read and whenever areas are saved.
 */
export function normalizeAreas(raw: unknown): ProjectArea[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const areas: ProjectArea[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const { id, name } = entry as Record<string, unknown>
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) continue
    if (typeof name !== 'string' || !name.trim()) continue
    seen.add(id)
    areas.push({ id, name: name.trim().slice(0, MAX_AREA_NAME_LENGTH) })
  }
  return areas
}

/**
 * Projects grouped by area: every area in area order (empty ones too, so the
 * sidebar can drop into them), then "No area" last. Within a group projects
 * keep the order they came in, which is the sidebar's order. A project whose
 * area no longer exists is in "No area". With no areas at all there is one
 * group, `area: null`, and callers show no heading.
 */
export function groupProjectsByArea<T extends { areaId?: string | null }>(
  projects: readonly T[],
  areas: readonly ProjectArea[]
): ProjectAreaGroup<T>[] {
  if (areas.length === 0) return [{ area: null, projects: [...projects] }]
  const groups = new Map<string, T[]>(areas.map((area) => [area.id, []]))
  const none: T[] = []
  for (const project of projects) {
    const group = project.areaId ? groups.get(project.areaId) : undefined
    if (group) group.push(project)
    else none.push(project)
  }
  return [
    ...areas.map((area) => ({ area, projects: groups.get(area.id)! })),
    { area: null, projects: none }
  ]
}

/** The area order after moving one area by `delta` places. */
export function moveArea(areas: readonly ProjectArea[], id: string, delta: number): ProjectArea[] {
  const from = areas.findIndex((area) => area.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= areas.length) return [...areas]
  const next = [...areas]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
