import { MONACO_THEME_NAME, type OstlerMonacoTheme } from '../../lib/monaco-theme-data'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useConfig } from '../../hooks/useConfig'
import {
  normalizeAppearance,
  resolveTheme,
  type AccentSetting,
  type DensitySetting,
  type ResolvedTheme,
  type ThemeSetting
} from '@shared/ostler-api'
import { accentTokens } from './accent'
import { applyAppearance, systemPrefersDark } from './apply-appearance'

export interface AppearanceSettings {
  theme: ThemeSetting
  density: DensitySetting
  accent: AccentSetting
}

export interface Appearance extends AppearanceSettings {
  /** 'system' resolved through the OS preference. */
  resolvedTheme: ResolvedTheme
  /** Windows' accent colour (`#RRGGBB`), when it can be read. */
  windowsAccent: string | null
  /** Saves a change to `ui` in the config and applies it at once. */
  setAppearance: (update: Partial<AppearanceSettings>) => Promise<boolean>
}

const AppearanceContext = createContext<Appearance | null>(null)

function settingsOf(value: unknown): AppearanceSettings {
  const { theme, density, accent } = normalizeAppearance(value)
  return { theme, density, accent }
}

/**
 * Owns the theme, density and accent for the whole renderer (P2.1). It starts
 * from the appearance main passed in (already applied by bootstrap.ts), checks
 * it against the saved config, follows the OS light/dark switch for 'system'
 * and Windows' accent colour, and keeps the `<html>` attributes in step.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const initial = window.ostlerAPI?.initialAppearance ?? null
  const [settings, setSettings] = useState<AppearanceSettings>(() => settingsOf(initial))
  const [systemDark, setSystemDark] = useState(systemPrefersDark)
  const [windowsAccent, setWindowsAccent] = useState<string | null>(
    () => normalizeAppearance(initial).windowsAccent
  )

  // The saved config wins over the start-up value (and stands in for it
  // where the window was opened without one).
  const { config } = useConfig({ enabled: !!window.ostlerAPI })
  const savedUi = config?.ui
  useEffect(() => {
    if (savedUi) setSettings(settingsOf(savedUi))
  }, [savedUi])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    setSystemDark(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => window.ostlerAPI?.onWindowsAccentChanged?.(setWindowsAccent), [])

  const resolvedTheme = resolveTheme(settings.theme, systemDark)
  const accent = useMemo(
    () => (settings.accent === 'windows' ? accentTokens(windowsAccent, resolvedTheme) : null),
    [settings.accent, windowsAccent, resolvedTheme]
  )

  useEffect(() => {
    applyAppearance({ theme: resolvedTheme, density: settings.density, accent })
  }, [resolvedTheme, settings.density, accent])

  const setAppearance = useCallback(
    async (update: Partial<AppearanceSettings>) => {
      const previous = settings
      setSettings({ ...previous, ...update })
      try {
        const result = await window.ostlerAPI.updateConfig({ ui: update })
        if (result.ok) return true
      } catch {
        // Falls through to the revert below.
      }
      setSettings(previous)
      return false
    },
    [settings]
  )

  const value = useMemo<Appearance>(
    () => ({ ...settings, resolvedTheme, windowsAccent, setAppearance }),
    [settings, resolvedTheme, windowsAccent, setAppearance]
  )

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

/**
 * The current appearance. Outside a ThemeProvider (isolated component tests)
 * it reads what is on `<html>` and cannot change it.
 */
export function useAppearance(): Appearance {
  const context = useContext(AppearanceContext)
  if (context) return context
  const root = document.documentElement
  const resolvedTheme: ResolvedTheme = root.dataset.theme === 'light' ? 'light' : 'dark'
  return {
    theme: resolvedTheme,
    density: root.dataset.density === 'compact' ? 'compact' : 'comfortable',
    accent: 'ostler',
    resolvedTheme,
    windowsAccent: null,
    setAppearance: async () => false
  }
}

/**
 * The Monaco theme for the current appearance: generated from the tokens
 * (lib/monaco-themes.ts), defined in each editor's `beforeMount`.
 */
export function useMonacoTheme(): OstlerMonacoTheme {
  return MONACO_THEME_NAME[useAppearance().resolvedTheme === 'dark' ? 'dark' : 'light']
}
