import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/shared/ostler-api/config-types'
import {
  DEVICE_ONLY_SETTINGS,
  mergePersonalSettings,
  personalSettings
} from '../../src/shared/sync/device-only-settings'

/** Whether a dotted path names a key of `config`, at every level. */
function hasPath(config: Record<string, unknown>, dotted: string): boolean {
  let current: unknown = config
  for (const part of dotted.split('.')) {
    if (typeof current !== 'object' || current === null || !(part in current)) return false
    current = (current as Record<string, unknown>)[part]
  }
  return true
}

/** A config as a second PC would hold it: every setting different from the first PC's. */
function otherPc(): Record<string, unknown> {
  const config = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>
  return {
    ...config,
    configVersion: 99,
    projects: [{ id: 'other' }],
    ui: { ...(config.ui as object), theme: 'light', sidebarWidth: 300 },
    automationApi: { enabled: true, port: 9999 },
    harness: { ...(config.harness as object), port: 9998, enabled: true },
    popOuts: { windows: [{ route: '/elsewhere' }] },
    stickyTasks: { windows: [{ route: '/sticky' }] },
    backups: { ...(config.backups as object), copyTo: 'D:/elsewhere' },
    desktop: {
      ...(config.desktop as object),
      startAtLogin: true,
      backgroundMode: true,
      quickAddHotkeyEnabled: true,
      quickAddHotkey: 'Ctrl+Alt+Q',
      snipHotkeyEnabled: true,
      snipHotkey: 'Ctrl+Alt+K',
      nativeTitleBar: true
    }
  }
}

describe('device-only settings (D3)', () => {
  it('lists only paths that exist in the real config', () => {
    for (const path of DEVICE_ONLY_SETTINGS) {
      expect(hasPath(DEFAULT_CONFIG as unknown as Record<string, unknown>, path), path).toBe(true)
    }
  })

  it('personal settings drop every device-only path and keep the rest', () => {
    const personal = personalSettings(DEFAULT_CONFIG as unknown as Record<string, unknown>)
    for (const path of DEVICE_ONLY_SETTINGS) {
      expect(hasPath(personal, path), path).toBe(false)
    }
    expect(personal).toHaveProperty('ui.theme')
    expect(personal).toHaveProperty('notifications.onBlocker')
    expect(personal).toHaveProperty('ai.apiKey')
    expect(personal).toHaveProperty('github.token')
    expect(personal).toHaveProperty('areas')
    expect(personal).toHaveProperty('history.saveMyEdits')
  })

  it('a merge keeps every device-only setting from the local PC and takes the personal ones', () => {
    const local = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>
    const incoming = otherPc()

    const merged = mergePersonalSettings(local, incoming)

    for (const path of DEVICE_ONLY_SETTINGS) {
      const localHas = hasPath(local, path)
      expect(hasPath(merged, path), path).toBe(localHas)
    }
    expect((merged.projects as unknown[]).length).toBe(0)
    expect((merged.popOuts as { windows: unknown[] }).windows).toEqual([])
    expect((merged.harness as { port: number }).port).toBe(DEFAULT_CONFIG.harness.port)
    expect((merged.automationApi as { port: number }).port).toBe(DEFAULT_CONFIG.automationApi.port)
    expect((merged.desktop as { startAtLogin: boolean }).startAtLogin).toBe(
      DEFAULT_CONFIG.desktop.startAtLogin
    )
    expect((merged.backups as { copyTo: unknown }).copyTo).toBe(DEFAULT_CONFIG.backups.copyTo)
    // A normal setting such as the theme travels.
    expect((merged.ui as { theme: string }).theme).toBe('light')
  })

  it('a top-level key the other PC does not send is left as it is here', () => {
    const local = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>
    const incoming = { ui: { ...DEFAULT_CONFIG.ui, theme: 'dark' } }
    const merged = mergePersonalSettings(local, incoming)
    expect((merged.ai as { model: string }).model).toBe(DEFAULT_CONFIG.ai.model)
    expect((merged.ui as { theme: string }).theme).toBe('dark')
  })
})
