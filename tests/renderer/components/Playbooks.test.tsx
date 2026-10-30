// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PlaybookRun,
  PlanningWorkItem,
  RendererProject,
  RunPlaybookInput,
  SaveTaskTemplateFromWorkItemInput,
  TaskTemplate,
  UpdateTaskTemplateInput
} from '@shared/ostler-api'
import { DEFAULT_CONFIG } from '@shared/ostler-api'
import { SaveTaskTemplateDialog } from '@renderer/task-templates/SaveTaskTemplateDialog'
import { TaskTemplatesGroup } from '@renderer/task-templates/TaskTemplatesGroup'
import { RunPlaybookDialog } from '@renderer/task-templates/RunPlaybookDialog'
import { CommandPalette } from '@renderer/components/CommandPalette'
import { AgentsTab } from '@renderer/views/workspace/AgentsTab'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import type { ViewContext } from '@renderer/navigation/registry'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'
import { makeWorkItem } from '../fixtures/planning-records'
import { renderPlanningWorkspace, withWorkspace } from '../fixtures/planning-workspace'

/** Playbooks (N9.6b): Save as playbook, the Playbooks group, and Run playbook. */

const withFolder = {
  id: 'p1',
  name: 'Website',
  enabled: true,
  path: 'C:\\temp\\site',
  color: '#3b82f6'
} as RendererProject
const noFolder = { ...withFolder, path: null } as RendererProject
let projects: RendererProject[] = [withFolder]

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects, areas: [], loading: false, refreshProjects: async () => {} })
}))

const agent = {
  model: '',
  effort: '' as const,
  planFirst: 'yes' as const,
  instructions: 'Keep major versions.'
}

function template(id: string, name: string, extra: Partial<TaskTemplate> = {}): TaskTemplate {
  return {
    id,
    projectId: 'p1',
    name,
    body: {
      title: 'Update the dependencies',
      description: '',
      checklist: [],
      labels: [],
      priority: 'medium',
      estimate: null,
      assigneeId: null,
      fieldValues: {},
      startDate: null,
      dueDate: null,
      subtasks: []
    },
    playbook: false,
    createdAt: 0,
    updatedAt: Date.UTC(2026, 9, 15),
    ...extra
  }
}

const playbook = template('pb', 'Update dependencies', {
  playbook: true,
  projectId: null,
  body: { ...template('x', 'x').body, agent }
})

const agentSettings = {
  getConfig: async () => ({ ok: true as const, value: DEFAULT_CONFIG as never }),
  getProjectAutoDispatchConfig: async () => ({
    ok: true as const,
    value: {
      projectId: 'p1',
      enabled: false,
      maxConcurrentEmbeddedSessions: 1,
      aiOverrideEnabled: false,
      defaultProvider: '',
      defaultModel: '',
      defaultEffort: '' as const,
      autoArchiveDoneAfterDays: 0
    }
  })
}

function wrap(element: React.ReactNode, agents = true) {
  return render(
    <MemoryRouter>
      <StaticFeaturesProvider value={{ agents, ai: false }}>
        <ToastProvider>
          <ConfirmProvider>{element}</ConfirmProvider>
        </ToastProvider>
      </StaticFeaturesProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  localStorage.clear()
  projects = [withFolder]
})

describe('Save as playbook', () => {
  const item: PlanningWorkItem = makeWorkItem('w1', { projectId: 'p1', title: 'Bump deps' })

  it('saves the task as a playbook with plan first and extra instructions', async () => {
    const saved: SaveTaskTemplateFromWorkItemInput[] = []
    installOstlerApi({
      ...agentSettings,
      getTaskTemplates: async () => ({ ok: true, value: [] }),
      saveTaskTemplateFromWorkItem: async (_id, input) => {
        saved.push(input)
        return { ok: true, value: template('t1', input.name ?? '', { playbook: true }) }
      }
    })
    let closed = false
    wrap(<SaveTaskTemplateDialog item={item} playbook onClose={() => (closed = true)} />)
    expect(screen.getByRole('dialog', { name: 'Save as playbook' })).toBeTruthy()
    await screen.findByLabelText('Model for this run')
    fireEvent.change(screen.getByLabelText('Plan first'), { target: { value: 'yes' } })
    fireEvent.change(screen.getByLabelText('Extra instructions for the agent'), {
      target: { value: 'Keep major versions.' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save playbook' }))
    await waitFor(() => expect(closed).toBe(true))
    expect(saved[0]).toMatchObject({
      name: 'Bump deps',
      scope: 'project',
      agent: { model: '', effort: '', planFirst: 'yes', instructions: 'Keep major versions.' }
    })
  })
})

describe('the Playbooks group', () => {
  it('lists playbooks apart and edits a playbook’s agent part', async () => {
    const updates: UpdateTaskTemplateInput[] = []
    installOstlerApi({
      ...agentSettings,
      getAllTaskTemplates: async () => ({
        ok: true,
        value: [playbook, template('t2', 'Invoices')]
      }),
      updateTaskTemplate: async (_id, input) => {
        updates.push(input)
        return { ok: true, value: playbook }
      }
    })
    wrap(<TaskTemplatesGroup />)
    const list = await screen.findByRole('list', { name: 'Playbooks' })
    expect(list.textContent).toContain('Update dependencies')
    expect(list.textContent).not.toContain('Invoices')
    expect(screen.getByRole('list', { name: 'Task templates' }).textContent).toContain('Invoices')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Update dependencies' }))
    const instructions = await screen.findByLabelText('Extra instructions for the agent')
    expect(instructions).toHaveProperty('value', 'Keep major versions.')
    fireEvent.change(instructions, { target: { value: 'Run the tests too.' } })
    fireEvent.change(screen.getByLabelText('Plan first'), { target: { value: 'no' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updates).toHaveLength(1))
    expect(updates[0]).toMatchObject({
      playbook: true,
      body: { agent: { planFirst: 'no', instructions: 'Run the tests too.' } }
    })
  })

  it('makes an ordinary template a playbook', async () => {
    const updates: UpdateTaskTemplateInput[] = []
    installOstlerApi({
      ...agentSettings,
      getAllTaskTemplates: async () => ({ ok: true, value: [template('t2', 'Invoices')] }),
      updateTaskTemplate: async (_id, input) => {
        updates.push(input)
        return { ok: true, value: template('t2', 'Invoices', { playbook: true }) }
      }
    })
    wrap(<TaskTemplatesGroup />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Invoices' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Playbook/ }))
    await screen.findByLabelText('Extra instructions for the agent')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updates).toHaveLength(1))
    expect(updates[0]).toMatchObject({ playbook: true, body: { agent: { planFirst: 'default' } } })
  })
})

describe('Run playbook', () => {
  const ran: { projectId: string; templateId: string; input?: RunPlaybookInput }[] = []
  const install = () =>
    installOstlerApi({
      getTaskTemplates: async () => ({ ok: true, value: [playbook, template('t2', 'Invoices')] }),
      runPlaybook: async (projectId, templateId, input) => {
        ran.push({ projectId, templateId, input })
        return {
          ok: true,
          value: {
            workItem: makeWorkItem('w9', { projectId, title: input?.title ?? 'Update' }),
            subtasks: [],
            dropped: { assignee: false, fieldCount: 0 },
            task: { id: 'h1' }
          } as unknown as PlaybookRun
        }
      }
    })

  it('offers this project’s and every project’s playbooks, and runs one with a new title', async () => {
    ran.length = 0
    install()
    let closed = false
    wrap(<RunPlaybookDialog project={withFolder} onClose={() => (closed = true)} />)
    const picker = await screen.findByLabelText('Playbook')
    expect(picker.textContent).toContain('Update dependencies')
    expect(picker.textContent).not.toContain('Invoices')
    const title = screen.getByLabelText('Task title')
    await waitFor(() => expect(title).toHaveProperty('value', 'Update the dependencies'))
    fireEvent.change(title, { target: { value: 'Update the dependencies for November' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(closed).toBe(true))
    expect(ran).toEqual([
      {
        projectId: 'p1',
        templateId: 'pb',
        input: { title: 'Update the dependencies for November' }
      }
    ])
  })

  it('says why it cannot run when agents are off or there is no folder', async () => {
    install()
    const { unmount } = wrap(<RunPlaybookDialog project={noFolder} onClose={() => {}} />)
    expect(await screen.findByText(/has no linked folder/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run' })).toHaveProperty('disabled', true)
    unmount()
    wrap(<RunPlaybookDialog project={withFolder} onClose={() => {}} />, false)
    expect(await screen.findByText(/Agents are off/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run' })).toHaveProperty('disabled', true)
  })

  function Where() {
    const location = useLocation()
    return <span data-testid="where">{location.pathname + location.search}</span>
  }

  const palette = (agents: boolean) => {
    Element.prototype.scrollIntoView = vi.fn()
    installOstlerApi({
      search: async () => ({ ok: true, value: [] }),
      listSavedViews: async () => ({ ok: true, value: [] })
    })
    return render(
      <MemoryRouter initialEntries={['/projects/p1']}>
        <StaticFeaturesProvider value={{ agents, ai: false }}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <CommandPalette open onOpenChange={vi.fn()} onNewProject={vi.fn()} />
                  <Where />
                </>
              }
            />
          </Routes>
        </StaticFeaturesProvider>
      </MemoryRouter>
    )
  }

  it('is in the command palette while agents are on, and opens Run playbook', async () => {
    palette(true)
    const field = screen.getByRole('combobox', { name: 'Command palette search' })
    fireEvent.change(field, { target: { value: 'Run playbook' } })
    const runOption = () =>
      screen.getAllByRole('option').find((entry) => entry.textContent?.includes('Run playbook'))
    await waitFor(() => expect(runOption()).toBeTruthy())
    const option = runOption()!
    fireEvent.click(option)
    expect(screen.getByTestId('where').textContent).toContain('runPlaybook=1')
  })

  it('is not in the command palette while agents are off', async () => {
    palette(false)
    const field = screen.getByRole('combobox', { name: 'Command palette search' })
    fireEvent.change(field, { target: { value: 'Run playbook' } })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(
      screen.queryAllByRole('option').some((entry) => entry.textContent?.includes('Run playbook'))
    ).toBe(false)
  })

  it('opens from the Agents tab', async () => {
    const base = await renderPlanningWorkspace()
    const setRunPlaybookOpen = vi.fn()
    const ws = withWorkspace(base, { setRunPlaybookOpen })
    wrap(
      <AgentsTab
        project={withFolder}
        ws={ws}
        features={{} as ViewContext}
        suggestTasks={{ busy: false, start: () => {} }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Run playbook…' }))
    expect(setRunPlaybookOpen).toHaveBeenCalledWith(true)
  })
})
