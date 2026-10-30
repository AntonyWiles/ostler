// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryItem, PlanningMilestone } from '@shared/ostler-api'
import type { PlanningTaskType } from '@shared/ostler-api/task-type-types'
import type { PolishReleaseNotesRequest } from '@shared/release-notes'
import { ReleaseNotesDialog } from '@renderer/views/planning/ReleaseNotesDialog'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { installOstlerApi } from '../fixtures/ostler-api'
import { makeWorkItem } from '../fixtures/planning-records'

afterEach(() => __resetDismissableStackForTests())

const milestone: PlanningMilestone = {
  id: 'm1',
  projectId: 'p1',
  goalId: null,
  name: 'Version 3',
  outcome: '',
  targetDate: null,
  successCriteria: [],
  status: 'active',
  createdAt: 0,
  updatedAt: 0
}
const bug: PlanningTaskType = {
  id: 'bug',
  projectId: 'p1',
  name: 'Bug',
  icon: 'bug',
  color: '#ef4444',
  position: 0,
  createdAt: 0,
  updatedAt: 0
}
const live = [
  makeWorkItem('a', {
    title: 'Crash fixed',
    status: 'done',
    milestoneId: 'm1',
    typeId: 'bug',
    labels: ['editor'],
    description: 'No more crash. Details.'
  }),
  makeWorkItem('b', { title: 'Open work', status: 'active', milestoneId: 'm1' })
]
const archived = [
  makeWorkItem('c', { title: 'Old task', status: 'done', milestoneId: 'm1', archivedAt: 5 })
]

function note(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: 'n1',
    projectId: 'p1',
    kind: 'note',
    title: 'Release notes: Version 3',
    summary: '',
    body: 'Old text',
    tags: ['release-notes'],
    aiAccess: 'human-only',
    isPrimaryBrief: false,
    revision: 1,
    archivedAt: null,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:00:00Z',
    ...overrides
  } as unknown as LibraryItem
}

function Where() {
  const location = useLocation()
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>
}

const onClose = vi.fn()

function shell(ui: ReactElement, ai = true) {
  return (
    <MemoryRouter initialEntries={['/projects/p1/milestones']}>
      <ConfirmProvider>
        <ToastProvider>
          <StaticFeaturesProvider value={{ agents: false, ai }}>
            <Routes>
              <Route path="*" element={<Where />} />
            </Routes>
            {ui}
          </StaticFeaturesProvider>
        </ToastProvider>
      </ConfirmProvider>
    </MemoryRouter>
  )
}

const dialog = (ai = true) =>
  render(
    shell(
      <ReleaseNotesDialog
        projectId="p1"
        source={{ kind: 'milestone', milestone }}
        liveItems={live}
        taskTypes={[bug]}
        onClose={onClose}
      />,
      ai
    )
  )

const preview = () => screen.getByLabelText('Preview') as HTMLTextAreaElement

describe('Write release notes', () => {
  let api: ReturnType<typeof installOstlerApi>
  const createLibraryItem = vi.fn()
  const updateLibraryItem = vi.fn()
  const listLibraryItems = vi.fn()
  const polishReleaseNotes = vi.fn()

  beforeEach(() => {
    onClose.mockReset()
    createLibraryItem.mockReset()
    updateLibraryItem.mockReset()
    listLibraryItems.mockReset()
    polishReleaseNotes.mockReset()
    listLibraryItems.mockResolvedValue({ ok: true, value: [] })
    createLibraryItem.mockImplementation(async (_projectId, input) => ({
      ok: true,
      value: note({ id: 'n2', body: input.body })
    }))
    updateLibraryItem.mockImplementation(async (_projectId, _id, updates) => ({
      ok: true,
      value: note(updates)
    }))
    api = installOstlerApi({
      getPlanningWorkItems: async () => ({ ok: true, value: archived }),
      listLibraryItems,
      createLibraryItem,
      updateLibraryItem,
      polishReleaseNotes
    })
  })

  it('previews the finished tasks, archived ones included, and follows the options', async () => {
    dialog()
    await waitFor(() => expect(preview().value).toContain('2 tasks finished'))
    expect(preview().value).toContain('## Bug\n\n- Crash fixed\n\n## Other\n\n- Old task')
    expect(preview().value).not.toContain('Open work')

    fireEvent.click(screen.getByRole('radio', { name: 'Label' }))
    expect(preview().value).toContain('## editor\n\n- Crash fixed')
    fireEvent.click(screen.getByRole('radio', { name: 'Nothing' }))
    expect(preview().value).not.toContain('## ')
    fireEvent.click(screen.getByLabelText("Include each task's first sentence"))
    expect(preview().value).toContain('- Crash fixed: No more crash.')
    expect(screen.getByLabelText('Include subtasks, under their parent')).toBeTruthy()
  })

  it('creates a tagged note and opens it in the Library', async () => {
    dialog()
    await waitFor(() => expect(preview().value).toContain('2 tasks finished'))
    fireEvent.click(screen.getByRole('button', { name: 'Create note' }))
    await waitFor(() => expect(createLibraryItem).toHaveBeenCalled())
    expect(createLibraryItem.mock.calls[0][1]).toEqual({
      kind: 'note',
      title: 'Release notes: Version 3',
      body: preview().value,
      tags: ['release-notes']
    })
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/projects/p1/library?item=n2')
    )
    expect(onClose).toHaveBeenCalled()
    expect(await screen.findByText('Release notes saved: Release notes: Version 3')).toBeTruthy()
  })

  it('asks before replacing a note with the same title, and can replace its text', async () => {
    listLibraryItems.mockResolvedValue({ ok: true, value: [note()] })
    dialog()
    await waitFor(() => expect(preview().value).toContain('2 tasks finished'))
    const draft = preview().value
    fireEvent.click(screen.getByRole('button', { name: 'Create note' }))
    expect(
      await screen.findByText('A note called "Release notes: Version 3" is already in the Library.')
    ).toBeTruthy()
    expect(createLibraryItem).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Replace its text' }))
    await waitFor(() => expect(updateLibraryItem).toHaveBeenCalledWith('p1', 'n1', { body: draft }))
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/projects/p1/library?item=n1')
    )
  })

  it('makes a new note instead when asked', async () => {
    listLibraryItems.mockResolvedValue({ ok: true, value: [note()] })
    dialog()
    await waitFor(() => expect(preview().value).toContain('2 tasks finished'))
    fireEvent.click(screen.getByRole('button', { name: 'Create note' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Make a new note' }))
    await waitFor(() => expect(createLibraryItem).toHaveBeenCalled())
    expect(updateLibraryItem).not.toHaveBeenCalled()
  })

  it('polishes with AI: the suggestion replaces the draft only on Accept, and warns of a missing task', async () => {
    dialog()
    await waitFor(() => expect(preview().value).toContain('2 tasks finished'))
    const draft = preview().value
    polishReleaseNotes.mockResolvedValue({
      ok: true,
      value: { draft, suggestion: '# Friendly\n\nWe fixed the crash.', missingTitles: ['Old task'] }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Polish with AI' }))
    expect(await screen.findByText('This version leaves out 1 task: Old task')).toBeTruthy()
    const request = polishReleaseNotes.mock.calls[0][1] as PolishReleaseNotesRequest
    expect(request).toEqual({
      source: { kind: 'milestone', id: 'm1' },
      options: { groupBy: 'type', descriptions: false, subtasks: false }
    })
    expect(preview().value).toBe(draft)

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.queryByText('This version leaves out 1 task: Old task')).toBeNull()
    expect(preview().value).toBe(draft)

    fireEvent.click(screen.getByRole('button', { name: 'Polish with AI' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    expect(preview().value).toBe('# Friendly\n\nWe fixed the crash.')

    fireEvent.click(screen.getByRole('button', { name: 'Create note' }))
    await waitFor(() => expect(createLibraryItem).toHaveBeenCalled())
    expect(createLibraryItem.mock.calls[0][1].body).toBe('# Friendly\n\nWe fixed the crash.')
  })

  it('hides Polish with AI while Ostler AI is off', async () => {
    dialog(false)
    await waitFor(() => expect(preview().value).toContain('2 tasks finished'))
    expect(screen.queryByRole('button', { name: 'Polish with AI' })).toBeNull()
    expect(api.polishReleaseNotes).toBe(polishReleaseNotes)
  })
})
