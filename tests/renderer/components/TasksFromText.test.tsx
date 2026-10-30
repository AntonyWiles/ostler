// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Person, PlanningWorkItem } from '@shared/ostler-api'
import type { TasksFromTextDraft } from '@shared/tasks-from-text'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { QuickAddForm } from '@renderer/components/quick-add/QuickAddForm'
import { CreateRecordModal } from '@renderer/views/planning/CreateRecordModal'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { installOstlerApi } from '../fixtures/ostler-api'
import { makeWorkItem } from '../fixtures/planning-records'

const project = { id: 'p1', name: 'Website', enabled: true, path: null }

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [project], loading: false, refreshProjects: async () => {} })
}))

const grace: Person = {
  id: 'person-grace',
  name: 'Grace Hopper',
  initials: 'GH',
  color: '#3366cc',
  isMe: false,
  archivedAt: null,
  weeklyCapacityHours: null,
  workingDays: [1, 2, 3, 4, 5],
  createdAt: 0,
  updatedAt: 0
} as Person

const draft: TasksFromTextDraft = {
  draftId: '30000000-0000-4000-8000-000000000001',
  projectId: 'p1',
  model: 'test-model',
  generatedAt: 0,
  suggestions: [
    {
      title: 'Book the venue',
      description: '',
      dueDate: '2026-10-23',
      personName: 'Grace',
      assigneeId: 'person-grace',
      checklist: ['Get quotes']
    },
    {
      title: 'Order badges',
      description: '',
      dueDate: null,
      personName: 'Linus',
      assigneeId: null,
      checklist: []
    }
  ],
  unmatchedNames: ['Linus'],
  badDates: 0,
  dropped: 0
}

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:photo')
  URL.revokeObjectURL = vi.fn()
  if (!File.prototype.arrayBuffer) {
    File.prototype.arrayBuffer = function (this: File) {
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.readAsArrayBuffer(this)
      })
    }
  }
})

beforeEach(() => __resetDismissableStackForTests())
afterEach(() => vi.clearAllMocks())

function install() {
  const findTasksFromText = vi.fn(async () => ({ ok: true as const, value: draft }))
  const created = [makeWorkItem('t1', { title: 'Book the venue' })] as PlanningWorkItem[]
  const addTasksFromText = vi.fn(async () => ({ ok: true as const, value: created }))
  const deletePlanningWorkItem = vi.fn(async () => ({ ok: true as const, value: undefined }))
  installOstlerApi({
    findTasksFromText,
    addTasksFromText,
    deletePlanningWorkItem,
    getPlanningLabels: async () => ({ ok: true, value: [] })
  })
  return { findTasksFromText, addTasksFromText, deletePlanningWorkItem }
}

function renderQuickAdd(ai: boolean) {
  return render(
    <MemoryRouter>
      <StaticFeaturesProvider value={{ ai, agents: false }}>
        <StaticPeopleProvider people={[grace]}>
          <ToastProvider>
            <QuickAddForm defaultProjectId="p1" />
          </ToastProvider>
        </StaticPeopleProvider>
      </StaticFeaturesProvider>
    </MemoryRouter>
  )
}

function photoFile(name = 'board.png', type = 'image/png'): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type })
}

describe('Tasks from text or a photo', () => {
  it('is hidden while Ostler AI is not set up', () => {
    install()
    renderQuickAdd(false)
    expect(screen.queryByRole('button', { name: /From text or a photo/ })).toBeNull()
  })

  it('opens from quick add with the dictation hint, and sends nothing before Find tasks', async () => {
    const api = install()
    renderQuickAdd(true)
    fireEvent.click(screen.getByRole('button', { name: /From text or a photo/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Tasks from text or a photo' })
    expect(within(dialog).getByText('Press Windows + H to dictate.')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Text'), {
      target: { value: 'Grace books the venue by next Friday. Linus orders badges.' }
    })
    expect(api.findTasksFromText).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Find tasks' }))
    await within(dialog).findByText(/No one on this PC matches Linus/)
    expect(api.findTasksFromText).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        text: 'Grace books the venue by next Friday. Linus orders badges.',
        photo: null
      })
    )
    expect(api.addTasksFromText).not.toHaveBeenCalled()
  })

  it('adds only the ticked suggestions, with one undo for them all', async () => {
    const api = install()
    renderQuickAdd(true)
    fireEvent.click(screen.getByRole('button', { name: /From text or a photo/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Tasks from text or a photo' })
    fireEvent.change(within(dialog).getByLabelText('Text'), { target: { value: 'notes' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Find tasks' }))
    await within(dialog).findByRole('button', { name: 'Add 2 tasks' })

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Suggestion 2/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 1 task' }))

    await waitFor(() => expect(api.addTasksFromText).toHaveBeenCalledTimes(1))
    expect(api.addTasksFromText).toHaveBeenCalledWith('p1', {
      draftId: draft.draftId,
      keepPhoto: null,
      tasks: [
        {
          title: 'Book the venue',
          description: '',
          dueDate: '2026-10-23',
          assigneeId: 'person-grace',
          checklist: ['Get quotes']
        }
      ]
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(api.deletePlanningWorkItem).toHaveBeenCalledWith('t1'))
  })

  it('takes a photo by file, by paste and by drop, and sends it only on Find tasks', async () => {
    const api = install()
    renderQuickAdd(true)
    fireEvent.click(screen.getByRole('button', { name: /From text or a photo/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Tasks from text or a photo' })

    fireEvent.change(within(dialog).getByTestId('tasks-from-text-file'), {
      target: { files: [photoFile('board.png')] }
    })
    expect(await within(dialog).findByText('board.png')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove photo' }))

    fireEvent.paste(within(dialog).getByLabelText('Text'), {
      clipboardData: { files: [photoFile('pasted.png')] }
    })
    expect(await within(dialog).findByText('pasted.png')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove photo' }))

    const zone = within(dialog).getByRole('button', { name: 'Add a photo' }).parentElement!
    fireEvent.drop(zone, { dataTransfer: { files: [photoFile('dropped.heic', '')] } })
    expect(await within(dialog).findByText('dropped.heic')).toBeTruthy()
    expect(within(dialog).getByRole('checkbox', { name: /Keep the photo/ })).toBeTruthy()
    expect(api.findTasksFromText).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Find tasks' }))
    await waitFor(() => expect(api.findTasksFromText).toHaveBeenCalledTimes(1))
    expect(api.findTasksFromText).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        photo: expect.objectContaining({ fileName: 'dropped.heic', mimeType: 'image/heic' })
      })
    )
  })

  it('refuses a file that is not a PNG, JPEG or HEIC photo', async () => {
    install()
    renderQuickAdd(true)
    fireEvent.click(screen.getByRole('button', { name: /From text or a photo/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Tasks from text or a photo' })
    fireEvent.change(within(dialog).getByTestId('tasks-from-text-file'), {
      target: { files: [photoFile('anim.gif', 'image/gif')] }
    })
    expect(await within(dialog).findByText(/PNG, JPEG or HEIC photo of up to 10 MB/)).toBeTruthy()
  })

  it('opens from New task beside the title', async () => {
    install()
    const ws = {
      createMode: 'work-item',
      closeCreate: vi.fn(),
      busy: false,
      projectId: 'p1',
      createPlanningRecord: vi.fn(),
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
    render(
      <MemoryRouter>
        <StaticFeaturesProvider value={{ ai: true, agents: false }}>
          <StaticPeopleProvider people={[grace]}>
            <ToastProvider>
              <CreateRecordModal ws={ws} selectedProject={undefined} />
            </ToastProvider>
          </StaticPeopleProvider>
        </StaticFeaturesProvider>
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: /From text or a photo/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Tasks from text or a photo' })
    expect(within(dialog).getByText('Press Windows + H to dictate.')).toBeTruthy()
  })
})
