// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InitialAppearance, RendererConfigUpdate } from '@shared/ostler-api'
import { ThemeProvider, useAppearance } from '@renderer/ui/theme/ThemeProvider'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../fixtures/ostler-api'

type Listener = (event: MediaQueryListEvent) => void

/** A controllable `prefers-color-scheme: dark` query. */
function mockSystemTheme(dark: boolean) {
  const listeners = new Set<Listener>()
  const query = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener)
  }
  window.matchMedia = vi.fn(() => query) as unknown as typeof window.matchMedia
  return {
    set(next: boolean) {
      query.matches = next
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent)
    }
  }
}

function installApi(ui: Partial<InitialAppearance>, updates: RendererConfigUpdate[] = []) {
  const appearance: InitialAppearance = {
    theme: 'system',
    density: 'comfortable',
    accent: 'ostler',
    windowsAccent: null,
    systemDark: false,
    ...ui
  }
  installOstlerApi({
    initialAppearance: appearance,
    getConfig: async () => ({
      ok: true,
      value: {
        ...RENDERER_DEFAULT_CONFIG,
        ui: {
          ...RENDERER_DEFAULT_CONFIG.ui,
          theme: appearance.theme,
          density: appearance.density,
          accent: appearance.accent
        }
      }
    }),
    updateConfig: async (update) => {
      updates.push(update)
      return { ok: true, value: RENDERER_DEFAULT_CONFIG }
    }
  })
}

function Probe() {
  const { resolvedTheme, setAppearance } = useAppearance()
  return (
    <>
      <span>resolved: {resolvedTheme}</span>
      <button onClick={() => void setAppearance({ density: 'compact' })}>compact</button>
    </>
  )
}

const html = document.documentElement

describe('ThemeProvider', () => {
  beforeEach(() => {
    html.removeAttribute('data-theme')
    html.removeAttribute('data-density')
    html.removeAttribute('style')
  })

  afterEach(() => vi.restoreAllMocks())

  it("resolves 'system' from matchMedia and sets the attributes", async () => {
    mockSystemTheme(true)
    installApi({ theme: 'system' })

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )

    await waitFor(() => expect(html.dataset.theme).toBe('dark'))
    expect(html.dataset.density).toBe('comfortable')
    expect(html.style.colorScheme).toBe('dark')
    expect(screen.getByText('resolved: dark')).toBeTruthy()
  })

  it('follows the OS switching between light and dark', async () => {
    const system = mockSystemTheme(false)
    installApi({ theme: 'system' })
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    await waitFor(() => expect(html.dataset.theme).toBe('light'))

    act(() => system.set(true))

    await waitFor(() => expect(html.dataset.theme).toBe('dark'))
    expect(html.style.colorScheme).toBe('dark')
  })

  it('ignores the OS when a theme is forced', async () => {
    const system = mockSystemTheme(true)
    installApi({ theme: 'light' })
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    await waitFor(() => expect(html.dataset.theme).toBe('light'))

    act(() => system.set(false))
    act(() => system.set(true))

    expect(html.dataset.theme).toBe('light')
  })

  it('saves a density change and applies it at once', async () => {
    mockSystemTheme(false)
    const updates: RendererConfigUpdate[] = []
    installApi({}, updates)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )

    act(() => screen.getByText('compact').click())

    await waitFor(() => expect(html.dataset.density).toBe('compact'))
    expect(updates).toEqual([{ ui: { density: 'compact' } }])
  })

  it('overrides the accent tokens with an adjusted Windows accent colour', async () => {
    mockSystemTheme(false)
    installApi({ theme: 'light', accent: 'windows', windowsAccent: '#60A5FA' })
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )

    await waitFor(() => expect(html.style.getPropertyValue('--color-accent')).not.toBe(''))
    expect(html.style.getPropertyValue('--color-accent')).not.toBe('#60A5FA')
  })
})
