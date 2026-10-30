import { BrowserWindow, nativeTheme, systemPreferences } from 'electron'
import {
  ACCENT_SETTINGS,
  DENSITY_SETTINGS,
  IPC_CHANNELS,
  THEME_SETTINGS,
  START_PAGE_SETTINGS,
  WINDOW_BACKGROUND,
  normalizeAccentColor,
  type InitialAppearance,
  type OstlerConfig,
  type OstlerConfigUpdate,
  type ResolvedTheme
} from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import { MAX_DISMISSED_TIPS, isTipId } from '@shared/tips'
import { isValidLanguageSetting } from './locale'

/**
 * Main's side of the theme (P2.1): it mirrors `ui.theme` in
 * `nativeTheme.themeSource`, so the frame, native menus and dialogs follow,
 * colours the window background from the resolved theme, and passes Windows'
 * accent colour to the renderer. The renderer owns the CSS
 * (src/renderer/ui/theme/).
 */

/** Windows' accent colour as `#RRGGBB`, or null where it cannot be read. */
function readWindowsAccent(): string | null {
  try {
    // RRGGBBAA; the alpha is dropped.
    return normalizeAccentColor(systemPreferences.getAccentColor())
  } catch {
    return null
  }
}

/** The theme in effect now, with 'system' resolved through Windows. */
export function resolvedTheme(): ResolvedTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

function paintWindowBackgrounds(): void {
  const color = WINDOW_BACKGROUND[resolvedTheme()]
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    // Every settings save comes through here; repainting a window whose
    // colour has not changed makes it flash on Windows.
    if (window.getBackgroundColor().toLowerCase() === color.toLowerCase()) continue
    window.setBackgroundColor(color)
  }
}

/** Mirrors the theme setting in nativeTheme and repaints every window behind the page. */
export function applyNativeTheme(ui: OstlerConfig['ui']): void {
  if (nativeTheme.themeSource !== ui.theme) nativeTheme.themeSource = ui.theme
  paintWindowBackgrounds()
}

/** The appearance a new window starts with, after applying the theme natively. */
export function initialAppearance(ui: OstlerConfig['ui']): InitialAppearance {
  applyNativeTheme(ui)
  return {
    theme: ui.theme,
    density: ui.density,
    accent: ui.accent,
    windowsAccent: readWindowsAccent(),
    // With themeSource 'system' this is the OS preference; the renderer only
    // uses it for 'system', and then follows matchMedia.
    systemDark: nativeTheme.shouldUseDarkColors
  }
}

export function windowBackground(appearance: InitialAppearance): string {
  if (appearance.theme === 'system') {
    return WINDOW_BACKGROUND[appearance.systemDark ? 'dark' : 'light']
  }
  return WINDOW_BACKGROUND[appearance.theme]
}

/** Rejects appearance values outside the settings' unions before they are stored. */
export function assertValidAppearanceUpdate(ui: OstlerConfigUpdate['ui']): void {
  if (!ui) return
  if (ui.theme !== undefined && !THEME_SETTINGS.includes(ui.theme)) {
    throw new Refusal(`Unknown theme: ${String(ui.theme)}`)
  }
  if (ui.density !== undefined && !DENSITY_SETTINGS.includes(ui.density)) {
    throw new Error(`Unknown density: ${String(ui.density)}`)
  }
  if (ui.accent !== undefined && !ACCENT_SETTINGS.includes(ui.accent)) {
    throw new Error(`Unknown accent: ${String(ui.accent)}`)
  }
  if (ui.startPage !== undefined && !START_PAGE_SETTINGS.includes(ui.startPage)) {
    throw new Error(`Unknown start page: ${String(ui.startPage)}`)
  }
  if (ui.language !== undefined && !isValidLanguageSetting(ui.language)) {
    throw new Error(`Unknown language: ${String(ui.language)}`)
  }
  if (ui.firstRunCompleted !== undefined && typeof ui.firstRunCompleted !== 'boolean') {
    throw new Error('The welcome is either finished or not')
  }
  if (
    ui.lastSeenVersion !== undefined &&
    (typeof ui.lastSeenVersion !== 'string' || ui.lastSeenVersion.length > 64)
  ) {
    throw new Error('The last seen version is a short version string')
  }
  if (ui.tips !== undefined) {
    const tips: unknown = ui.tips
    if (typeof tips !== 'object' || tips === null) throw new Error('Tips are a setting object')
    const { enabled, dismissed } = tips as Record<string, unknown>
    if (enabled !== undefined && typeof enabled !== 'boolean')
      throw new Error('Tips are either on or off')
    if (
      dismissed !== undefined &&
      (!Array.isArray(dismissed) ||
        dismissed.length > MAX_DISMISSED_TIPS ||
        !dismissed.every(isTipId))
    )
      throw new Error('Dismissed tips are a short list of tip ids')
  }
  // The checklist changes through its own calls (recordGettingStarted), which only tick.
  if (ui.gettingStarted !== undefined) {
    throw new Error('Getting started changes through its own calls')
  }
}

let watching = false

/**
 * Follows the OS for the life of the app: Windows' light/dark switch (for
 * 'system') repaints the window backgrounds, and an accent change is sent to
 * every window.
 */
export function watchSystemAppearance(): void {
  if (watching) return
  watching = true
  nativeTheme.on('updated', paintWindowBackgrounds)
  systemPreferences.on('accent-color-changed', (_event, color) => {
    const accent = normalizeAccentColor(color)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.ON_WINDOWS_ACCENT_CHANGED, accent)
      }
    }
  })
}
