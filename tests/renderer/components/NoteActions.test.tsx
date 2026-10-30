// @vitest-environment jsdom
import { createRef } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryItem, Person } from '@shared/ostler-api'
import type { NoteActionsDraft } from '@shared/note-actions'
import { LibraryDetail } from '@renderer/views/project-detail/library/LibraryDetail'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { installOstlerApi } from '../fixtures/ostler-api'

const grace = {
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

const note = {
  id: '10000000-0000-4000-8000-000000000001',
  projectId: 'p1',
  kind: 'note',
  title: 'Weekly sync, 14 March',
  summary: '',
  body: '## Actions\n\nGrace books the venue.',
  tags: [],
  aiAccess: 'when-selected',
  isPrimaryBrief: false,
  revision: 2,
  archivedAt: null,
  createdAt: '2026-03-14T10:00:00Z',
  updatedAt: '2026-03-14T10:00:00Z'
} as unknown as LibraryItem

const draft: NoteActionsDraft = {
  draftId: '30000000-0000-4000-8000-000000000001',
  projectId: 'p1',
  model: 'test-model',
  generatedAt: 0,
  itemId: note.id,
  noteTitle: note.title,
  revision: 2,
  suggestions: [
    {
      title: 'Book the venue',
      description: '',
      dueDate: '2026-03-20',
      personName: 'Grace',
      assigneeId: 'person-grace',
      checklist: [],
      alreadyTaskId: null
    },
    {
      title: 'Order badges',
      description: '',
      dueDate: null,
      personName: null,
      assigneeId: null,
      checklist: [],
      alreadyTaskId: null
    },
    {
      title: 'Send the agenda',
      description: '',
      dueDate: null,
      personName: null,
      assigneeId: null,
      checklist: [],
      alreadyTaskId: null
    },
    {
      title: 'Write the minutes',
      description: '',
      dueDate: null,
      personName: null,
      assigneeId: null,
      checklist: [],
      alreadyTaskId: 'task-old'
    }
  ],
  decisions: [{ title: 'Town hall', decision: 'We use the town hall.', context: 'Cheaper' }],
  unmatchedNames: [],
  badDates: 0,
  dropped: 0
}

beforeEach(() => __resetDismissableStackForTests())
afterEach(() => vi.clearAllMocks())

function install() {
  const findNoteActions = vi.fn(async () => ({ ok: true as const, value: draft }))
  const addNoteActions = vi.fn(async () => ({
    ok: true as const,
    value: { taskIds: ['t1', 't2', 't3'], decisionIds: ['d1'] }
  }))
  const deletePlanningWorkItem = vi.fn(async (_id: string) => ({
    ok: true as const,
    value: undefined
  }))
  const deletePlanningDecision = vi.fn(async () => ({ ok: true as const, value: undefined }))
  installOstlerApi({
    findNoteActions,
    addNoteActions,
    deletePlanningWorkItem,
    deletePlanningDecision,
    listItemWorkItems: async () => ({ ok: true, value: [] }),
    listItemAttachments: async () => ({ ok: true, value: [] })
  })
  return { findNoteActions, addNoteActions, deletePlanningWorkItem, deletePlanningDecision }
}

function renderDetail(item: LibraryItem, ai = true) {
  const noop = async () => {}
  return render(
    <MemoryRouter>
      <StaticFeaturesProvider value={{ ai, agents: false }}>
        <StaticPeopleProvider people={[grace]}>
          <ToastProvider>
            <LibraryDetail
              item={item}
              summaryRef={createRef()}
              onUpdate={noop}
              onSetPrimary={noop}
              onEdit={() => {}}
              onOpen={() => {}}
              onArchive={noop}
              onDelete={noop}
              onOpenWorkItem={() => {}}
            />
          </ToastProvider>
        </StaticPeopleProvider>
      </StaticFeaturesProvider>
    </MemoryRouter>
  )
}

describe('Find actions and decisions', () => {
  it('shows the button on a note Ostler AI may read, and is hidden while AI is off', () => {
    install()
    const { unmount } = renderDetail(note)
    expect(screen.getByRole('button', { name: 'Find actions and decisions' })).toBeTruthy()
    unmount()
    renderDetail(note, false)
    expect(screen.queryByRole('button', { name: 'Find actions and decisions' })).toBeNull()
  })

  it('says why a Human only note has no button, and sends nothing', () => {
    const api = install()
    renderDetail({ ...note, aiAccess: 'human-only' })
    expect(screen.queryByRole('button', { name: 'Find actions and decisions' })).toBeNull()
    expect(screen.getByText(/This note is set so Ostler AI never reads it/)).toBeTruthy()
    expect(api.findNoteActions).not.toHaveBeenCalled()
  })

  it('reviews tasks and decisions in two lists, with Already a task unticked', async () => {
    const api = install()
    renderDetail(note)
    fireEvent.click(screen.getByRole('button', { name: 'Find actions and decisions' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Actions and decisions in “Weekly sync, 14 March”'
    })
    await within(dialog).findByRole('button', { name: 'Add 3 tasks and 1 decision' })
    expect(api.findNoteActions).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ itemId: note.id })
    )
    expect(within(dialog).getByRole('heading', { name: 'Tasks' })).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: 'Decisions' })).toBeTruthy()
    expect(within(dialog).getByText('Already a task')).toBeTruthy()
    const already = within(dialog).getByRole('checkbox', {
      name: /Suggestion 4/
    }) as HTMLInputElement
    expect(already.checked).toBe(false)
    expect(within(dialog).getByText('3 of 4 will be added')).toBeTruthy()
    expect(within(dialog).getByText('1 of 1 will be added')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Decision 1/ }))
    expect(within(dialog).getByRole('button', { name: 'Add 3 tasks' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Decision 1/ }))
    expect(api.addNoteActions).not.toHaveBeenCalled()
  })

  it('adds the ticked ones, and one undo removes both the tasks and the decision', async () => {
    const api = install()
    renderDetail(note)
    fireEvent.click(screen.getByRole('button', { name: 'Find actions and decisions' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(
      await within(dialog).findByRole('button', { name: 'Add 3 tasks and 1 decision' })
    )

    await waitFor(() => expect(api.addNoteActions).toHaveBeenCalledTimes(1))
    expect(api.addNoteActions).toHaveBeenCalledWith('p1', {
      draftId: draft.draftId,
      itemId: note.id,
      tasks: [
        expect.objectContaining({ title: 'Book the venue', assigneeId: 'person-grace' }),
        expect.objectContaining({ title: 'Order badges' }),
        expect.objectContaining({ title: 'Send the agenda' })
      ],
      decisions: [{ title: 'Town hall', decision: 'We use the town hall.', context: 'Cheaper' }]
    })
    expect(await screen.findByText('Added 3 tasks and 1 decision from the note')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(api.deletePlanningWorkItem).toHaveBeenCalledTimes(3))
    expect(api.deletePlanningDecision).toHaveBeenCalledWith('d1')
    expect(api.deletePlanningWorkItem.mock.calls.map((call) => call[0])).toEqual(['t1', 't2', 't3'])
  })
})
