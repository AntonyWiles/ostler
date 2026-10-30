// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NewProjectWizard } from '@renderer/components/NewProjectWizard'
import type { NewProjectRequest, ProjectTemplateSummary, RendererProject } from '@shared/ostler-api'
import { installOstlerApi } from '../fixtures/ostler-api'

// The projects already in Ostler, for the name's duplicate warning.
const ostler = vi.hoisted(() => ({
  projects: [] as { id: string; name: string; enabled?: boolean; demo?: string }[]
}))
vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: ostler.projects, loading: false, refreshProjects: async () => {} })
}))

function project(path: string | null): RendererProject {
  return {
    id: 'p1',
    name: 'Wedding',
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

const TEMPLATES: ProjectTemplateSummary[] = [
  {
    id: 'blank',
    source: 'built-in',
    name: 'Blank project',
    description: 'Empty',
    icon: 'file',
    milestoneCount: 0,
    taskCount: 0,
    firstTasks: []
  },
  {
    id: 'event-planning',
    source: 'built-in',
    name: 'Event planning',
    description: 'Organise an event',
    icon: 'calendar',
    milestoneCount: 3,
    taskCount: 12,
    firstTasks: ['Set the budget', 'Shortlist venues']
  },
  {
    id: 'study-plan',
    source: 'built-in',
    name: 'Study plan',
    description: 'Prepare for an exam',
    icon: 'book',
    milestoneCount: 2,
    taskCount: 9,
    firstTasks: ['Gather the syllabus']
  },
  {
    id: 'sample',
    source: 'built-in',
    name: 'Welcome to Ostler (Demo Project)',
    description: 'A short tour',
    icon: 'sparkles',
    milestoneCount: 2,
    taskCount: 11,
    firstTasks: []
  }
]

/** Past the first step, "How do you want to start?", choosing Blank. */
async function startBlank() {
  await waitFor(() =>
    expect(screen.getByRole('radio', { name: 'From a template' })).toHaveProperty('disabled', false)
  )
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
}

function setup() {
  const requests: NewProjectRequest[] = []
  installOstlerApi({
    getNewProjectDefaults: async () => ({
      ok: true,
      value: {
        parentPath: 'C:\\projects',
        gitAvailable: true,
        gitIdentityConfigured: true,
        colors: ['#3b82f6', '#ec4899']
      }
    }),
    checkNewProjectLocation: async (parentPath, folderName) => ({
      ok: true,
      value: { projectPath: `${parentPath}\\${folderName}`, problem: null }
    }),
    browseForFolder: async () => ({ ok: true, value: 'C:\\projects\\site' }),
    listProjectTemplates: async () => ({ ok: true, value: TEMPLATES }),
    createProject: async (request) => {
      requests.push(request)
      const folder =
        request.folder === null
          ? null
          : request.folder.kind === 'existing'
            ? request.folder.path
            : `${request.folder.parentPath}\\${request.folder.folderName}`
      return {
        ok: true,
        value: {
          project: { ...project(folder), name: request.name },
          createdFiles: [],
          gitInitialized: false,
          committed: false,
          warnings: []
        }
      }
    }
  })
  const onCreated = vi.fn()
  render(<NewProjectWizard onClose={vi.fn()} onCreated={onCreated} onOpen={vi.fn()} />)
  return { requests, onCreated }
}

describe('NewProjectWizard', () => {
  it('starts by asking how to start, with Blank chosen and Import offered', async () => {
    setup()
    expect(screen.getByRole('group', { name: 'How do you want to start?' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Blank' })).toHaveProperty('checked', true)
    expect(screen.getByRole('radio', { name: 'Import into a new project' })).toHaveProperty(
      'disabled',
      false
    )
    await startBlank()
  })

  it('then asks where the project lives, with "Just in Ostler" chosen', async () => {
    setup()
    await startBlank()
    expect(screen.getByRole('group', { name: 'Where does this project live?' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Just in Ostler' })).toHaveProperty('checked', true)
    expect(screen.getByText(/For most projects/)).toBeTruthy()
  })

  it('creates a project with no folder after the name and colour', async () => {
    const { requests, onCreated } = setup()
    await startBlank()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Wedding' } })
    await waitFor(() => screen.getByRole('radio', { name: 'Pink' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Pink' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(requests[0]).toMatchObject({ name: 'Wedding', color: '#ec4899', folder: null })
    expect(requests[0].templateId).toBeUndefined()
    expect(screen.getByText(/link a folder in Settings › Projects/)).toBeTruthy()
  })

  it('asks how to begin, with Start working now chosen, and sends no stage by default', async () => {
    const { requests } = setup()
    await startBlank()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('group', { name: 'How do you want to begin?' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Start working now' })).toHaveProperty('checked', true)
    expect(screen.getByRole('radio', { name: 'Plan it first' })).toHaveProperty('checked', false)
    expect(screen.getByText(/The project is Active\./)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Wedding' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect('stage' in requests[0]).toBe(false)
  })

  it('sends the Planning stage when Plan it first is chosen', async () => {
    const { requests } = setup()
    await startBlank()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Wedding' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Plan it first' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({ name: 'Wedding', stage: 'planning' })
  })

  it('does not ask how to begin for an import or the demo projects', async () => {
    const { requests } = setup()
    fireEvent.click(screen.getByRole('radio', { name: 'Import into a new project' }))
    expect(screen.queryByRole('radio', { name: 'Plan it first' })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'The demo projects' }))
    expect(screen.queryByRole('radio', { name: 'Plan it first' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(requests).toHaveLength(2))
    for (const request of requests) expect('stage' in request).toBe(false)
  })

  it('uses a picked existing folder, naming the project after it', async () => {
    const { requests } = setup()
    await startBlank()
    fireEvent.click(screen.getByRole('radio', { name: 'A folder on this PC' }))
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Folder')).toHaveProperty('value', 'C:\\projects\\site')
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByLabelText('Project name')).toHaveProperty('value', 'site')
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0].folder).toEqual({ kind: 'existing', path: 'C:\\projects\\site' })
  })

  it('keeps the new-folder setup and review steps', async () => {
    const { requests } = setup()
    await startBlank()
    fireEvent.click(screen.getByRole('radio', { name: 'A new folder' }))
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'thesis' } })
    await waitFor(() => expect(screen.getByText(/Will be created at/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('checkbox', { name: 'Initialize a Git repository' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0].folder).toMatchObject({
      kind: 'new',
      parentPath: 'C:\\projects',
      folderName: 'thesis',
      initGit: true
    })
  })

  it('starts from a template: shows its contents and names the project after it', async () => {
    const { requests } = setup()
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'From a template' })).toHaveProperty(
        'disabled',
        false
      )
    )
    fireEvent.click(screen.getByRole('radio', { name: 'From a template' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    // Blank and the sample project are choices of their own, not templates here.
    expect(screen.queryByRole('radio', { name: 'Blank project' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Welcome to Ostler (Demo Project)' })).toBeNull()
    expect(screen.getByRole('radio', { name: 'Event planning' })).toHaveProperty('checked', true)
    expect(screen.getByText('3 milestones, 12 tasks')).toBeTruthy()
    expect(screen.getByText('Shortlist venues')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Study plan' }))
    expect(screen.getByText('2 milestones, 9 tasks')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByLabelText('Project name')).toHaveProperty('value', 'Study plan')
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      name: 'Study plan',
      templateId: 'study-plan',
      folder: null
    })
  })

  it('adds both demo projects in one step, in Ostler only', async () => {
    const { requests } = setup()
    fireEvent.click(screen.getByRole('radio', { name: 'The demo projects' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests).toMatchObject([
      { name: 'Welcome to Ostler (Demo Project)', templateId: 'sample', folder: null },
      { name: 'Harbour Café refit (Advanced Demo)', templateId: 'demo-advanced', folder: null }
    ])
  })

  it('adds only the demo project that is missing', async () => {
    ostler.projects = [
      { id: 'old', name: 'Welcome to Ostler (Demo Project)', enabled: true, demo: 'simple' }
    ]
    try {
      const { requests } = setup()
      fireEvent.click(screen.getByRole('radio', { name: 'The demo projects' }))
      fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
      await waitFor(() => expect(requests).toHaveLength(1))
      expect(requests[0]).toMatchObject({ templateId: 'demo-advanced' })
    } finally {
      ostler.projects = []
    }
  })
  it('joins a shared project from a pasted invite', async () => {
    const joinShare = vi.fn(async () => ({
      ok: true as const,
      value: { projectId: 'shared-1', name: 'Garden' }
    }))
    installOstlerApi({
      getNewProjectDefaults: async () => ({ ok: true, value: { colors: [] } as never }),
      listProjectTemplates: async () => ({ ok: true, value: TEMPLATES }),
      joinShare,
      getProjects: async () => ({
        ok: true,
        value: [{ ...project(null), id: 'shared-1', name: 'Garden' }]
      })
    })
    const onCreated = vi.fn()
    render(<NewProjectWizard onClose={vi.fn()} onCreated={onCreated} onOpen={vi.fn()} />)

    expect(screen.queryByRole('textbox', { name: 'Invite' })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Join a shared project' }))
    const join = screen.getByRole('button', { name: 'Join…' })
    expect(join).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByRole('textbox', { name: 'Invite' }), {
      target: { value: '  ostler-invite:1:abc  ' }
    })
    fireEvent.click(join)

    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(joinShare).toHaveBeenCalledWith('ostler-invite:1:abc')
    expect(onCreated.mock.calls[0][0]).toMatchObject({ id: 'shared-1', name: 'Garden' })
  })
})
