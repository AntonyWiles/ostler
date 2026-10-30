/**
 * The phone's colours, taken from the desktop's design tokens (`src/renderer/styles/tokens.css`,
 * the light and dark blocks) so the phone looks like Ostler. The screens take their colours from
 * `useTheme`: light, dark, or the system's setting, as chosen in Settings.
 */
import { useSyncExternalStore } from 'react'
import { useColorScheme } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import type { PlanningWorkItemStatus, ThemeSetting } from '@shared/ostler-api'

export interface Theme {
  bg: string
  surface: string
  surfaceSunken: string
  border: string
  borderStrong: string
  text: string
  textSecondary: string
  textMuted: string
  accent: string
  accentContrast: string
  accentSubtle: string
  success: string
  successSubtle: string
  warning: string
  warningSubtle: string
  danger: string
  dangerSubtle: string
}

export const LIGHT: Theme = {
  bg: '#f6f7f9',
  surface: '#ffffff',
  surfaceSunken: '#f0f2f5',
  border: '#e2e6ec',
  borderStrong: '#c9d0da',
  text: '#1b2230',
  textSecondary: '#4b5565',
  textMuted: '#5f6a7b',
  accent: '#4f46e5',
  accentContrast: '#ffffff',
  accentSubtle: '#eef0fe',
  success: '#147a3a',
  successSubtle: '#e7f6ec',
  warning: '#b45309',
  warningSubtle: '#fdf3e1',
  danger: '#c81e1e',
  dangerSubtle: '#fdecec'
}

export const DARK: Theme = {
  bg: '#111318',
  surface: '#171a21',
  surfaceSunken: '#0d0f13',
  border: '#2a303b',
  borderStrong: '#3a4250',
  text: '#e7eaf0',
  textSecondary: '#b6beca',
  textMuted: '#8f99a8',
  accent: '#5b5bd6',
  accentContrast: '#ffffff',
  accentSubtle: '#232347',
  success: '#4ade80',
  successSubtle: '#16291f',
  warning: '#fbbf24',
  warningSubtle: '#2e2614',
  danger: '#f87171',
  dangerSubtle: '#321a1c'
}

// The choice is kept on the phone (it is not synced: each device has its own light).
const THEME_KEY = 'ostler.theme'
const listeners = new Set<() => void>()
let setting: ThemeSetting = readSetting()

function readSetting(): ThemeSetting {
  const stored = SecureStore.getItem(THEME_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

/** Light, dark or the system's setting, as chosen in Settings. */
export function useThemeSetting(): ThemeSetting {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => setting
  )
}

export function setThemeSetting(next: ThemeSetting): void {
  setting = next
  SecureStore.setItem(THEME_KEY, next)
  for (const listener of listeners) listener()
}

/** Whether the screens are dark: the chosen theme, or the system's for 'system'. */
export function useIsDark(): boolean {
  const chosen = useThemeSetting()
  const system = useColorScheme()
  return chosen === 'system' ? system === 'dark' : chosen === 'dark'
}

/** The colours for the chosen theme. */
export function useTheme(): Theme {
  return useIsDark() ? DARK : LIGHT
}

/** The colour that marks a status, from the theme's own colours. */
export function statusColor(theme: Theme, status: PlanningWorkItemStatus): string {
  switch (status) {
    case 'done':
      return theme.success
    case 'blocked':
      return theme.danger
    case 'review':
      return theme.warning
    case 'active':
    case 'ready':
      return theme.accent
    default:
      return theme.textMuted
  }
}

/** Spacing and corner sizes the screens share (the desktop's tokens are small and flat too). */
export const SPACE = { small: 8, medium: 12, large: 16 } as const
export const RADIUS = 8
