// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  NewProjectRequest,
  Person,
  ProjectTemplateSummary,
  RendererConfigUpdate,
  RendererProject
} from '@shared/ostler-api'
import { ADVANCED_DEMO_TEMPLATE_ID, SAMPLE_TEMPLATE_ID } from '@shared/ostler-api'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { FirstRunGate } from '@renderer/welcome/FirstRunGate'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'

const refreshProjects = vi.fn(async () => {})
vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [], loading: false, refreshProjects })
}))

const ME: Person = {
  id: 'me',
  name: 'jordan',
  initials: 'A',
  color: '#3b82f6',
  isMe: true,
  archivedAt: null,
  weeklyCapacityHours: null,
  workingDays: [1, 2, 3, 4, 5],
  projectId: null,
  createdAt: 0,
  updatedAt: 0
}

const TEMPLATES: ProjectTemplateSummary[] = [
  {
    id: 'event-planning',
    source: 'built-in',
    name: 'Event planning',
    description: 'Organise an event',
    icon: 'calendar',
    milestoneCount: 3,
    taskCount: 12,
    firstTasks: ['Set the budget']
  },
  {
    id: SAMPLE_TEMPLATE_ID,
    source: 'built-in',
    name: 'Welcome to Ostler (Demo Project)',
    description: 'A short tour',
    icon: 'sparkles',
    milestoneCount: 2,
    taskCount: 11,
    firstTasks: []
  }
]

function project(name: string, path: string | null = null): RendererProject {
  return {
    id: 'p1',
    name,
    path,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: 0,
    lastActivity: null,
    hasAutomationToken: false
  }
}

let created: NewProjectRequest[]
let configUpdates: RendererConfigUpdate[]
let renamed: { personId: string; name?: string }[]

function setup(firstRunCompleted = false) {
  created = []
  configUpdates = []
  renamed = []
  installOstlerApi({
    getConfig: async () => ({
      ok: true,
      value: {
        ...RENDERER_DEFAULT_CONFIG,
        ui: { ...RENDERER_DEFAULT_CONFIG.ui, firstRunCompleted }
      }
    }),
    getAppVersion: async () => ({ ok: true, value: '1.2.3' }),
    listProjectTemplates: async () => ({ ok: true, value: TEMPLATES }),
    updateConfig: async (updates) => {
      configUpdates.push(updates)
      return { ok: true, value: RENDERER_DEFAULT_CONFIG }
    },
    updatePerson: async (personId, updates) => {
      renamed.push({ personId, name: updates.name })
      return { ok: true, value: { ...ME, name: updates.name ?? ME.name } }
    },
    createProject: async (request) => {
      created.push(request)
      return {
        ok: true,
        value: {
          project: project(request.name),
          createdFiles: [],
          gitInitialized: false,
          committed: false,
          warnings: []
        }
      }
    },
    browseForFolder: async () => ({ ok: true, value: 'C:\\work\\site' }),
    linkProjectFolder: async () => ({ ok: true, value: project('Site', 'C:\\work\\site') })
  })
}

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>
}

function renderGate() {
  render(
    <ToastProvider>
      <ConfirmProvider>
        <StaticPeopleProvider people={[ME]}>
          <MemoryRouter initialEntries={['/home']}>
            <FirstRunGate>
              <p>The app</p>
            </FirstRunGate>
            <Routes>
              <Route path="*" element={<Where />} />
            </Routes>
          </MemoryRouter>
        </StaticPeopleProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}

/** Step 1: a name, then Continue. */
async function introduce(name = 'Jordan Reyes') {
  const field = await screen.findByRole('textbox', { name: 'What should we call you?' })
  await waitFor(() => expect(field).toHaveProperty('value', 'jordan'))
  fireEvent.change(field, { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', { name: 'How do you want to start?' })
}

describe('the first-run welcome (P8.1)', () => {
  beforeEach(() => refreshProjects.mockClear())

  it('never shows to someone who has finished it', async () => {
    setup(true)
    renderGate()
    expect(await screen.findByText('The app')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /^Welcome to/ })).toBeNull()
  })

  it('starts with the demo projects, skipping the rest, and lands on the simple one’s Overview', async () => {
    setup()
    renderGate()
    expect(await screen.findByRole('heading', { name: 'Welcome to Ostler' })).toBeTruthy()
    // Every choice is a native control, so it works from the keyboard.
    expect(screen.getByRole('radio', { name: /Dark/ })).toBeTruthy()
    await introduce()
    // The demos are set apart, not one of the ways to start a project.
    expect(screen.queryByRole('radio', { name: /demo/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start with the demo projects' }))

    // No optional extras: straight into the simple demo.
    await screen.findByText('The app')
    expect(renamed).toEqual([{ personId: 'me', name: 'Jordan Reyes' }])
    // Both demo projects come together; the welcome lands in the simple one.
    expect(created).toMatchObject([
      { name: 'Welcome to Ostler (Demo Project)', templateId: SAMPLE_TEMPLATE_ID },
      { name: 'Harbour Café refit (Advanced Demo)', templateId: ADVANCED_DEMO_TEMPLATE_ID }
    ])
    expect(screen.getByTestId('where').textContent).toBe('/projects/p1/overview')
    expect(configUpdates).toContainEqual({
      ui: { firstRunCompleted: true, lastSeenVersion: '1.2.3' }
    })
  })

  it('starts from a template by default, chosen on a step of its own, then offers the optional extras', async () => {
    setup()
    renderGate()
    await introduce()
    expect(screen.getByRole('radio', { name: /Start from a template/ })).toHaveProperty(
      'checked',
      true
    )
    // Unnumbered progress: a template's path has four steps.
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('Step 2 of 4')
    expect(screen.queryByRole('radio', { name: /Event planning/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Choose a template' })
    expect(await screen.findByRole('radio', { name: /Event planning/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await screen.findByRole('heading', { name: 'A few optional extras' })
    expect(created).toMatchObject([{ name: 'Event planning', templateId: 'event-planning' }])
    // Agents are offered only once a folder is linked.
    expect(screen.queryByRole('heading', { name: 'Use AI agents?' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open the project' }))
    await screen.findByText('The app')
    expect(screen.getByTestId('where').textContent).toBe('/projects/p1/overview')
  })

  it('starts a blank project once it has a name', async () => {
    setup()
    renderGate()
    await introduce()
    fireEvent.click(screen.getByRole('radio', { name: /A blank project/ }))
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('Step 2 of 3')
    const create = screen.getByRole('button', { name: 'Create project' })
    expect(create).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), {
      target: { value: 'Garden' }
    })
    fireEvent.click(create)
    await screen.findByRole('heading', { name: 'A few optional extras' })
    expect(created).toMatchObject([{ name: 'Garden', folder: null }])
    expect(created[0].templateId).toBeUndefined()
  })

  it('hands an import over to the import dialog', async () => {
    setup()
    renderGate()
    await introduce()
    fireEvent.click(screen.getByRole('radio', { name: /^Import/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose a file…' }))
    expect(await screen.findByRole('dialog', { name: 'Import' })).toBeTruthy()
    expect(created).toEqual([])
  })

  it('offers agents once a folder is linked', async () => {
    setup()
    renderGate()
    await introduce()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create project' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Link a folder…' }))
    expect(await screen.findByRole('heading', { name: 'Use AI agents?' })).toBeTruthy()
    expect(screen.getByText(/Linked to C:\\work\\site/)).toBeTruthy()
  })

  it('creates nothing when skipped, and lands on Home', async () => {
    setup()
    renderGate()
    await screen.findByRole('heading', { name: 'Welcome to Ostler' })
    fireEvent.change(screen.getByRole('textbox', { name: 'What should we call you?' }), {
      target: { value: 'Someone else' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    await screen.findByText('The app')
    expect(created).toEqual([])
    expect(renamed).toEqual([])
    expect(configUpdates).toEqual([{ ui: { firstRunCompleted: true, lastSeenVersion: '1.2.3' } }])
    expect(screen.getByTestId('where').textContent).toBe('/home')
  })
})
