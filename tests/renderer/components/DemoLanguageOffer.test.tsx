// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NewProjectRequest, RendererProject } from '@shared/ostler-api'
import { applyLocale } from '@shared/i18n'
import { DemoLanguageOffer } from '@renderer/components/DemoLanguageOffer'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

const ostler = vi.hoisted(() => ({
  projects: [] as RendererProject[],
  refreshProjects: vi.fn(async () => {})
}))
vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: ostler.projects, refreshProjects: ostler.refreshProjects })
}))
const locale = vi.hoisted(() => ({ language: 'en' }))
vi.mock('@renderer/i18n/LocaleProvider', () => ({
  useLocale: () => ({ language: locale.language, formatLocale: locale.language, languages: [] })
}))

const demo = (id: string, name: string, kind: 'simple' | 'advanced') =>
  ({ id, name, enabled: true, path: null, demo: kind }) as unknown as RendererProject

const ENGLISH_DEMOS = [
  demo('d1', 'Welcome to Ostler (Demo Project)', 'simple'),
  demo('d2', 'Harbour Café refit (Advanced Demo)', 'advanced')
]

function renderOffer({ untouched }: { untouched: boolean }) {
  const calls: string[] = []
  installOstlerApi({
    getDemoProjects: async () => {
      calls.push('status')
      return {
        ok: true,
        value: {
          projects: ostler.projects.map((project) => ({
            id: project.id,
            name: project.name,
            kind: project.demo!,
            enabled: true
          })),
          addedTasks: 0,
          addedComments: 0,
          untouched
        }
      }
    },
    removeDemoProjects: async () => {
      calls.push('remove')
      return { ok: true, value: 2 }
    },
    createProject: async (request: NewProjectRequest) => {
      calls.push(`create ${request.name}`)
      return { ok: true, value: { project: { ...ENGLISH_DEMOS[0], id: request.name } } }
    }
  } as never)
  const view = render(
    <MemoryRouter>
      <ToastProvider>
        <DemoLanguageOffer />
      </ToastProvider>
    </MemoryRouter>
  )
  const switchTo = (language: string) => {
    applyLocale({ language, formatLocale: language })
    locale.language = language
    view.rerender(
      <MemoryRouter>
        <ToastProvider>
          <DemoLanguageOffer />
        </ToastProvider>
      </MemoryRouter>
    )
  }
  return { calls, switchTo }
}

afterEach(() => {
  applyLocale({ language: 'en', formatLocale: 'en' })
  locale.language = 'en'
})

describe('DemoLanguageOffer', () => {
  it('offers untouched demos in the new language, and makes them again in it', async () => {
    ostler.projects = ENGLISH_DEMOS
    const { calls, switchTo } = renderOffer({ untouched: true })
    expect(calls).toEqual([])
    act(() => switchTo('de'))
    fireEvent.click(await screen.findByRole('button', { name: 'Demos umstellen' }))
    await waitFor(() =>
      expect(calls).toEqual([
        'status',
        'status',
        'remove',
        'create Willkommen bei Ostler (Demoprojekt)',
        'create Umbau des Harbour Café (fortgeschrittene Demo)'
      ])
    )
  })

  it('leaves demos someone has worked in alone', async () => {
    ostler.projects = ENGLISH_DEMOS
    const { calls, switchTo } = renderOffer({ untouched: false })
    act(() => switchTo('de'))
    await waitFor(() => expect(calls).toEqual(['status']))
    expect(screen.queryByRole('button', { name: 'Demos umstellen' })).toBeNull()
  })

  it('says nothing when the demos are already in the new language', async () => {
    ostler.projects = [
      demo('d1', 'Willkommen bei Ostler (Demoprojekt)', 'simple'),
      demo('d2', 'Umbau des Harbour Café (fortgeschrittene Demo)', 'advanced')
    ]
    const { calls, switchTo } = renderOffer({ untouched: true })
    act(() => switchTo('de'))
    await act(async () => {})
    expect(calls).toEqual([])
  })
})
