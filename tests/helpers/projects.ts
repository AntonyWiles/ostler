import type { WatchedProject } from '../../src/shared/ostler-api'

/**
 * A watched project with every required field filled in. Tests name only what
 * they care about, so a new required field is added here once.
 */
export function makeWatchedProject(overrides: Partial<WatchedProject> = {}): WatchedProject {
  return {
    id: 'project-1',
    name: 'Project',
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: 0,
    lastActivity: null,
    ...overrides
  }
}
