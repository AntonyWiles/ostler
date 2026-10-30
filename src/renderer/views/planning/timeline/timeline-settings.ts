import type { TaskViewSpec } from '../../../hooks/task-view-spec'
import type { TimelineZoom } from '../../../ui/timeline-scale'
import type { TimelineGroupBy } from '@shared/planning/timeline-rows'

export type { TimelineGroupBy }

/**
 * The Timeline view's own settings per project: zoom, grouping, the
 * collapsed groups, Show critical path and Compare with. A per-viewer convenience in localStorage, stored like
 * the Calendar's (`calendar-settings.ts`), all projects under one key.
 */

export interface TimelineViewSettings {
  zoom: TimelineZoom
  groupBy: TimelineGroupBy
  /** Group keys (`timeline-rows.ts`) that are collapsed. */
  collapsed: string[]
  /** Show critical path (N7.3). */
  criticalPath: boolean
  /** The milestone it is for, or null for the project's end. */
  criticalFor: string | null
  /** Compare with (N7.4): the baseline drawn under today's bars, or null for none. */
  compareWith: string | null
}

/** What is stored under `TIMELINE_SETTINGS_KEY`. */
export interface StoredTimelineSettings {
  version: 1
  projects: Record<string, TimelineViewSettings>
}

export const TIMELINE_SETTINGS_KEY = 'ostler.viewSettings.timeline'

export function defaultTimelineSettings(): TimelineViewSettings {
  return {
    zoom: 'month',
    groupBy: 'milestone',
    collapsed: [],
    criticalPath: false,
    criticalFor: null,
    compareWith: null
  }
}

/** Settings as stored, made safe: anything unknown falls back to the default. */
export function normalizeTimelineSettings(value: unknown): TimelineViewSettings {
  const fallback = defaultTimelineSettings()
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Partial<Record<keyof TimelineViewSettings, unknown>>
  return {
    zoom:
      raw.zoom === 'week' || raw.zoom === 'month' || raw.zoom === 'quarter'
        ? raw.zoom
        : fallback.zoom,
    groupBy:
      raw.groupBy === 'milestone' || raw.groupBy === 'assignee' || raw.groupBy === 'none'
        ? raw.groupBy
        : fallback.groupBy,
    collapsed: Array.isArray(raw.collapsed)
      ? raw.collapsed.filter((key): key is string => typeof key === 'string').slice(0, 500)
      : fallback.collapsed,
    criticalPath: typeof raw.criticalPath === 'boolean' ? raw.criticalPath : fallback.criticalPath,
    criticalFor:
      typeof raw.criticalFor === 'string' && raw.criticalFor.length <= 200
        ? raw.criticalFor
        : fallback.criticalFor,
    compareWith:
      typeof raw.compareWith === 'string' && raw.compareWith.length <= 200
        ? raw.compareWith
        : fallback.compareWith
  }
}

/**
 * The Timeline's state lives in its saved views (P5.7). `TIMELINE_SETTINGS_KEY`
 * is where P5.5 kept it in localStorage; the first load moves it into the
 * project's default view.
 */
export const TIMELINE_VIEW_SPEC: TaskViewSpec<TimelineViewSettings> = {
  normalize: normalizeTimelineSettings,
  legacyKey: TIMELINE_SETTINGS_KEY
}
