import type { TimelineOverviewFilter } from '@shared/planning/timeline-overview'
import type { TimelineZoom } from '../../ui/timeline-scale'

/**
 * How the Timeline across projects (N5.4) looks: its zoom and which projects
 * it shows. A per-viewer convenience in localStorage, like the Calendar's and
 * the List's (decision N2): no migration.
 */
export interface TimelineOverviewSettings {
  zoom: TimelineZoom
  filter: TimelineOverviewFilter
}

export const TIMELINE_OVERVIEW_SETTINGS_KEY = 'ostler.viewSettings.timelineOverview'

export function defaultTimelineOverviewSettings(): TimelineOverviewSettings {
  return { zoom: 'month', filter: { kind: 'all' } }
}

function normalizeFilter(value: unknown): TimelineOverviewFilter {
  if (!value || typeof value !== 'object') return { kind: 'all' }
  const raw = value as Record<string, unknown>
  if (raw.kind === 'area' && typeof raw.areaId === 'string' && raw.areaId.length <= 200)
    return { kind: 'area', areaId: raw.areaId }
  if (raw.kind === 'chosen' && Array.isArray(raw.projectIds))
    return {
      kind: 'chosen',
      projectIds: raw.projectIds
        .filter((id): id is string => typeof id === 'string' && id.length <= 200)
        .slice(0, 500)
    }
  return { kind: 'all' }
}

/** Settings as stored, made safe: anything unknown falls back to the default. */
export function normalizeTimelineOverviewSettings(value: unknown): TimelineOverviewSettings {
  const fallback = defaultTimelineOverviewSettings()
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Record<string, unknown>
  return {
    zoom:
      raw.zoom === 'week' || raw.zoom === 'month' || raw.zoom === 'quarter'
        ? raw.zoom
        : fallback.zoom,
    filter: normalizeFilter(raw.filter)
  }
}

export function loadTimelineOverviewSettings(): TimelineOverviewSettings {
  try {
    const stored = localStorage.getItem(TIMELINE_OVERVIEW_SETTINGS_KEY)
    return normalizeTimelineOverviewSettings(stored ? JSON.parse(stored) : null)
  } catch {
    return defaultTimelineOverviewSettings()
  }
}

export function saveTimelineOverviewSettings(settings: TimelineOverviewSettings): void {
  try {
    localStorage.setItem(TIMELINE_OVERVIEW_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Storage full or off: the view still works, it just forgets.
  }
}
