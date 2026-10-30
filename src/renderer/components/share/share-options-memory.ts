import type { CalendarExportOptions, ShareReportOptions } from '@shared/ostler-api'
import {
  normalizeShareReportOptions,
  type ResolvedShareReportOptions
} from '@shared/export/share-report'

/**
 * The calendar file's and the shareable report's options (R4.1), remembered
 * per viewer in localStorage, the way `more-details-memory.ts` remembers its
 * section. A convenience, not data: when storage is unavailable the defaults
 * apply (D37).
 */
const REPORT_KEY = 'ostler.shareReportOptions'
const CALENDAR_KEY = 'ostler.calendarFileOptions'

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore -- see read
  }
}

export function readShareReportOptions(): ResolvedShareReportOptions {
  return normalizeShareReportOptions(read(REPORT_KEY))
}

export function writeShareReportOptions(options: ShareReportOptions): void {
  write(REPORT_KEY, normalizeShareReportOptions(options))
}

export function readCalendarFileOptions(): Required<CalendarExportOptions> {
  const raw = read(CALENDAR_KEY) as CalendarExportOptions | null
  return {
    includeFinished: raw?.includeFinished === true,
    includeBlocks: raw?.includeBlocks === true
  }
}

export function writeCalendarFileOptions(options: CalendarExportOptions): void {
  write(CALENDAR_KEY, {
    includeFinished: options.includeFinished === true,
    includeBlocks: options.includeBlocks === true
  })
}
