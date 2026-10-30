/**
 * Which settings follow the person to their other devices, and which stay on this one
 * (docs/plans/people-and-devices/overview.md, D3).
 *
 * Everything in `config.json` follows the person except the paths listed here: the window layout,
 * the automation and agent tokens and ports, the backups' second place, the desktop settings that
 * register with Windows, and the config's own bookkeeping. Projects do not travel as settings at
 * all: they arrive through their shares. Areas do travel.
 *
 * Each entry is a dotted path into `OstlerConfig`. A top-level key stands for the whole key.
 */
import type { OstlerConfig } from '../ostler-api/config-types'

/** Dotted paths into `OstlerConfig` that stay on the device they were set on (D3). */
export const DEVICE_ONLY_SETTINGS = [
  // The config's own bookkeeping, and the projects list (projects arrive through their shares).
  'configVersion',
  'projects',
  // Window layout: each window's place and size, and the sidebar's width in pixels.
  'popOuts',
  'stickyTasks',
  'ui.sidebarWidth',
  // Automation and agent tokens and ports.
  'automationApi',
  'harness',
  // The backups' second place, and what this device last copied there.
  'backups.copyTo',
  'backups.lastCopiedAt',
  'backups.copyFailedAt',
  // Windows integration: sign-in start, background mode (tray), the title bar, and the system-wide keys.
  'desktop.nativeTitleBar',
  'desktop.backgroundMode',
  'desktop.startAtLogin',
  'desktop.quickAddHotkeyEnabled',
  'desktop.quickAddHotkey',
  'desktop.snipHotkeyEnabled',
  'desktop.snipHotkey'
] as const satisfies readonly string[]

export type DeviceOnlySetting = (typeof DEVICE_ONLY_SETTINGS)[number]

type Obj = Record<string, unknown>

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A copy of `source` without the dotted `path`; a parent left empty stays, as an empty object. */
function omitPath(source: Obj, path: string): Obj {
  const [head, ...rest] = path.split('.')
  if (!(head in source)) return source
  if (rest.length === 0) {
    const { [head]: _removed, ...others } = source
    return others
  }
  const child = source[head]
  if (!isObject(child)) return source
  return { ...source, [head]: omitPath(child, rest.join('.')) }
}

/** A copy of `target` with the dotted `path` set to what `source` holds there (or removed). */
function copyPath(target: Obj, source: Obj, path: string): Obj {
  const [head, ...rest] = path.split('.')
  if (rest.length === 0) {
    if (!(head in source)) {
      const { [head]: _removed, ...others } = target
      return others
    }
    return { ...target, [head]: source[head] }
  }
  const targetChild = isObject(target[head]) ? (target[head] as Obj) : {}
  const sourceChild = isObject(source[head]) ? (source[head] as Obj) : {}
  return { ...target, [head]: copyPath(targetChild, sourceChild, rest.join('.')) }
}

/**
 * The part of a config that follows the person: every setting except the device-only ones.
 * Returns a fresh object; `config` is not changed.
 */
export function personalSettings(config: Partial<OstlerConfig> | Obj): Obj {
  let personal: Obj = { ...(config as Obj) }
  for (const path of DEVICE_ONLY_SETTINGS) personal = omitPath(personal, path)
  return personal
}

/**
 * The config a device should have after taking `incoming`'s personal settings: every personal
 * setting from `incoming`, and every device-only setting kept as `local` has it. Keys `incoming`
 * does not hold are left as they are in `local`.
 */
export function mergePersonalSettings(local: Obj, incoming: Obj): Obj {
  let merged: Obj = { ...local, ...personalSettings(incoming) }
  for (const path of DEVICE_ONLY_SETTINGS) merged = copyPath(merged, local, path)
  return merged
}
