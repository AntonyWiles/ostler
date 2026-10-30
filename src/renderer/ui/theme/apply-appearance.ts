import type { DensitySetting, ResolvedTheme } from '@shared/ostler-api'
import type { AccentTokens } from './accent'

export interface AppliedAppearance {
  theme: ResolvedTheme
  density: DensitySetting
  /** Overrides the accent tokens; null keeps the Ostler accent from tokens.css. */
  accent: AccentTokens | null
}

/** Whether the OS prefers dark right now (false where matchMedia is missing). */
export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false
}

/**
 * Puts an appearance on `<html>`: `data-theme`, `data-density`, the
 * `color-scheme` native controls follow, and the accent override. The bootstrap
 * calls it before React renders; ThemeProvider calls it on every change.
 */
export function applyAppearance(
  appearance: AppliedAppearance,
  root: HTMLElement = document.documentElement
): void {
  root.dataset.theme = appearance.theme
  root.dataset.density = appearance.density
  root.style.colorScheme = appearance.theme
  if (appearance.accent) {
    root.style.setProperty('--color-accent', appearance.accent.accent)
    root.style.setProperty('--color-accent-hover', appearance.accent.accentHover)
    root.style.setProperty('--color-focus', appearance.accent.accent)
    root.style.setProperty(
      '--color-accent-subtle',
      'color-mix(in srgb, var(--color-accent) 16%, var(--color-surface))'
    )
  } else {
    for (const property of [
      '--color-accent',
      '--color-accent-hover',
      '--color-focus',
      '--color-accent-subtle'
    ]) {
      root.style.removeProperty(property)
    }
  }
}
