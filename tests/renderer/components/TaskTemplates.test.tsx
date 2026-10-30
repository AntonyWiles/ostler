// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PlanningWorkItem,
  SaveTaskTemplateFromWorkItemInput,
  TaskTemplate
} from '@shared/ostler-api'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { shiftIsoDate, todayIsoDate } from '@shared/dates'
import { SaveTaskTemplateDialog } from '@renderer/task-templates/SaveTaskTemplateDialog'
import { TaskTemplatesGroup } from '@renderer/task-templates/TaskTemplatesGroup'
import { QuickAddForm } from '@renderer/components/quick-add/QuickAddForm'
import { CreateRecordModal } from '@renderer/views/planning/CreateRecordModal'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'
import { makeWorkItem } from '../fixtures/planning-records'

const project = { id: 'p1', name: 'Website', enabled: true, path: null }

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [project], loading: false, refreshProjects: async () => {} })
}))

function template(id: string, name: string, extra: Partial<TaskTemplate> = {}): TaskTemplate {
  return {
    id,
    projectId: 'p1',
    name,
    body: {
      title: 'Send invoices',
      description: 'Every Friday',
      checklist: ['Export', 'Send'],
      labels: ['admin'],
      priority: 'high',
      estimate: null,
      assigneeId: null,
      fieldValues: {},
      startDate: null,
      dueDate: '+3d',
      subtasks: [{ title: 'Chase', description: '', checklist: [] }]
    },
    playbook: false,
    createdAt: 0,
    updatedAt: Date.UTC(2026, 9, 15),
    ...extra
  }
}

function wrap(element: React.ReactNode) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>{element}</ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>
  )
}

beforeEach(() => localStorage.clear())

describe('SaveTaskTemplateDialog', () => {
  const item: PlanningWorkItem = makeWorkItem('w1', {
    projectId: 'p1',
    title: 'Invoice run',
    targetDate: '2026-10-20'
  })

  it('saves with the title as its name, for every project, keeping dates', async () => {
    const saved: SaveTaskTemplateFromWorkItemInput[] = []
    installOstlerApi({
      getTaskTemplates: async () => ({ ok: true, value: [] }),
      saveTaskTemplateFromWorkItem: async (_id, input) => {
        saved.push(input)
        return { ok: true, value: template('t1', input.name ?? '') }
      }
    })
    let closed = false
    wrap(<SaveTaskTemplateDialog item={item} onClose={() => (closed = true)} />)
    expect(screen.getByLabelText('Template name')).toHaveProperty('value', 'Invoice run')
    fireEvent.click(screen.getByRole('radio', { name: /Every project/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Keep the dates/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    await waitFor(() => expect(closed).toBe(true))
    expect(saved[0]).toEqual({
      name: 'Invoice run',
      scope: 'every',
      keepDates: true,
      replace: false
    })
  })

  it('asks before replacing a template of the same name', async () => {
    const saved: SaveTaskTemplateFromWorkItemInput[] = []
    installOstlerApi({
      getTaskTemplates: async () => ({ ok: true, value: [template('t1', 'invoice RUN')] }),
      saveTaskTemplateFromWorkItem: async (_id, input) => {
        saved.push(input)
        return { ok: true, value: template('t1', 'Invoice run') }
      }
    })
    wrap(<SaveTaskTemplateDialog item={item} onClose={() => {}} />)
    await waitFor(() => expect(window.ostlerAPI.getTaskTemplates).toBeDefined())
    await new Promise((resolve) => setTimeout(resolve, 0))
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Replace template' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0].replace).toBe(true)
  })
})

describe('TaskTemplatesGroup', () => {
  it('lists every template with its scope, and deletes one at once with undo', async () => {
    let templates = [template('a', 'Bug report', { projectId: null }), template('b', 'Invoices')]
    const restored: string[] = []
    installOstlerApi({
      getAllTaskTemplates: async () => ({ ok: true, value: templates }),
      deleteTaskTemplate: async (id) => {
        const gone = templates.find((entry) => entry.id === id)!
        templates = templates.filter((entry) => entry.id !== id)
        return { ok: true, value: { template: gone } }
      },
      restoreTaskTemplate: async (deletion) => {
        restored.push(deletion.template.id)
        templates = [...templates, deletion.template]
        return { ok: true, value: deletion.template }
      }
    })
    wrap(<TaskTemplatesGroup />)
    expect(await screen.findByText('Bug report')).toBeTruthy()
    expect(screen.getByText(/Every project · changed/)).toBeTruthy()
    expect(screen.getByText(/Website · changed/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Invoices' }))
    await waitFor(() => expect(screen.queryByText('Invoices')).toBeNull())
    fireEvent.click(await screen.findByRole('button', { name: /Undo/ }))
    await waitFor(() => expect(restored).toEqual(['b']))
  })
})

describe('Quick add with a task template', () => {
  it('makes the task from the template, the typed date and label winning', async () => {
    const used = vi.fn(async (_projectId: string, _id: string, _overrides?: object) => ({
      ok: true as const,
      value: {
        workItem: { id: 'w1', projectId: 'p1', title: 'Send invoices' } as never,
        subtasks: [],
        dropped: { assignee: false, fieldCount: 0 }
      }
    }))
    installOstlerApi({
      getPlanningLabels: async () => ({ ok: true, value: [] }),
      getTaskTemplates: async () => ({ ok: true, value: [template('t1', 'Invoices')] }),
      useTaskTemplate: used
    })
    wrap(<QuickAddForm defaultProjectId="p1" />)
    fireEvent.change(await screen.findByRole('combobox', { name: 'From template' }), {
      target: { value: 't1' }
    })
    const field = screen.getByRole('textbox', { name: 'Quick add a task' })
    fireEvent.change(field, { target: { value: 'tomorrow #urgent' } })
    fireEvent.submit(field.closest('form')!)
    await waitFor(() => expect(used).toHaveBeenCalled())
    expect(used).toHaveBeenCalledWith('p1', 't1', {
      labels: ['urgent'],
      targetDate: shiftIsoDate(todayIsoDate(), 1)
    })
  })
})

describe('New task from a template', () => {
  it('fills the form from the template, dates counted from today', async () => {
    installOstlerApi({
      getTaskTemplates: async () => ({ ok: true, value: [template('t1', 'Invoices')] })
    })
    const applyTaskTemplate = vi.fn()
    const ws = {
      projectId: 'p1',
      createMode: 'work-item',
      busy: false,
      closeCreate: vi.fn(),
      createPlanningRecord: vi.fn(),
      itemTemplateId: '',
      applyTaskTemplate,
      itemTitle: '',
      setItemTitle: vi.fn(),
      itemDescription: '',
      itemPictures: [],
      setItemPictures: vi.fn(),
      setItemDescription: vi.fn(),
      itemStatus: 'backlog',
      statusWords: {
        visible: () => ['backlog'],
        label: () => 'Backlog',
        places: () => [{ key: 'backlog', status: 'backlog', columnId: null, label: 'Backlog' }],
        keyOf: () => 'backlog',
        taskLabel: () => 'Backlog'
      },
      itemPriority: 'medium',
      itemMilestoneId: '',
      milestones: [],
      goals: [],
      iterations: [],
      itemIterationId: null,
      taskTypes: [],
      itemTypeId: '',
      setItemTypeId: vi.fn(),
      setItemIterationId: vi.fn(),
      itemLabels: '',
      itemCriteria: '',
      itemAssigneeId: null,
      itemStartDate: '',
      itemTargetDate: '',
      itemEstimate: null,
      itemDependencyIds: [],
      workItems: [],
      fields: [],
      itemFieldValues: {},
      itemAutoQueue: false
    } as unknown as PlanningWorkspace
    wrap(
      <StaticFeaturesProvider value={{ ai: false, agents: false }}>
        <CreateRecordModal ws={ws} selectedProject={undefined} />
      </StaticFeaturesProvider>
    )
    fireEvent.change(await screen.findByRole('combobox', { name: 'From template' }), {
      target: { value: 't1' }
    })
    expect(applyTaskTemplate).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        title: 'Send invoices',
        labels: ['admin'],
        acceptanceCriteria: ['Export', 'Send'],
        priority: 'high',
        targetDate: shiftIsoDate(todayIsoDate(), 3)
      })
    )
  })
})
