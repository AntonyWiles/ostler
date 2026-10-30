/**
 * Page zoom (P9.2): Ctrl+=, Ctrl+- and Ctrl+0 step through these sizes, the
 * way a browser does, and main applies the result with
 * `webContents.setZoomLevel`. `ui.zoom` keeps the Chromium zoom level
 * (0 is 100%; each level is 1.2 times the last), so a restart opens at the
 * same size.
 */

/** The sizes zoom steps through, in percent. Layouts are checked up to 200%. */
export const ZOOM_PERCENTS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300] as const

const LEVEL_BASE = 1.2

export function zoomLevelForPercent(percent: number): number {
  return Math.log(percent / 100) / Math.log(LEVEL_BASE)
}

export function zoomPercentForLevel(level: number): number {
  return Math.round(100 * LEVEL_BASE ** level)
}

const MIN_LEVEL = zoomLevelForPercent(ZOOM_PERCENTS[0])
const MAX_LEVEL = zoomLevelForPercent(ZOOM_PERCENTS[ZOOM_PERCENTS.length - 1])

/** A stored zoom level, made safe: a number within the steps' range, else 0 (100%). */
export function normalizeZoomLevel(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, value))
}

export type ZoomStep = 'in' | 'out' | 'reset'

/** The zoom level one step from `level`: the next size up or down, or 100%. */
export function stepZoomLevel(level: number, step: ZoomStep): number {
  if (step === 'reset') return 0
  const percent = zoomPercentForLevel(normalizeZoomLevel(level))
  const next =
    step === 'in'
      ? ZOOM_PERCENTS.find((candidate) => candidate > percent)
      : [...ZOOM_PERCENTS].reverse().find((candidate) => candidate < percent)
  return next === undefined ? normalizeZoomLevel(level) : zoomLevelForPercent(next)
}
