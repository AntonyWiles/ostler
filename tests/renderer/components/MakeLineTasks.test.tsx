// @vitest-environment jsdom
import { createRef, type ReactElement } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ItemLinkRef, LibraryItem } from '@shared/ostler-api'
import type { MakeLineTasksInput } from '@shared/note-line-tasks'
import { BRAND } from '@shared/brand'
import { LibraryEditor } from '@renderer/views/project-detail/library/LibraryEditor'
import { LibraryDetail } from '@renderer/views/project-detail/library/LibraryDetail'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { installOstlerApi } from '../fixtures/ostler-api'

afterEach(() => {
  __resetDismissableStackForTests()
  vi.clearAllMocks()
})

const S = BRAND.urlScheme
const P = '0f8fad5b-d9cb-469f-a165-70867728950e'
const T1 = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const T2 = '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b'

const BODY = 'Venue\n- call the venue about parking #admin\n- [ ] send the draft !high'

function note(body = BODY): LibraryItem {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    projectId: P,
    kind: 'note',
    title: 'Venue notes',
    summary: '',
    body,
    url: null,
    file: null,
    tags: [],
    aiAccess: 'human-only',
    isPrimaryBrief: false,
    revision: 3,
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z'
  }
}

function install() {
  const makeLineTasks = vi.fn(async (_projectId: string, input: MakeLineTasksInput) => ({
    ok: true as const,
    value: {
      taskIds: input.tasks.map((_task, index) => [T1, T2][index]),
      item: {
        ...note(),
        revision: 4,
        body: `Venue\n- [call the venue about parking #admin](${S}://task/${P}/${T1})\n- [ ] [send the draft !high](${S}://task/${P}/${T2})`
      }
    }
  }))
  const undoLineTasks = vi.fn(async () => ({ ok: true as const, value: note() }))
  const resolveItemLinks = vi.fn(async (refs: ItemLinkRef[]) => ({
    ok: true as const,
    value: refs.map((ref) => ({
      ...ref,
      exists: true,
      title: ref.id === T1 ? 'Call the venue about parking' : 'Send the draft',
      status: ref.id === T1 ? ('done' as const) : ('backlog' as const)
    }))
  }))
  installOstlerApi({
    makeLineTasks,
    undoLineTasks,
    resolveItemLinks,
    getPlanningLabels: async () => ({ ok: true, value: [] }),
    listLibraryRevisions: async () => ({ ok: true, value: [] }),
    listItemWorkItems: async () => ({ ok: true, value: [] }),
    listItemAttachments: async () => ({ ok: true, value: [] })
  })
  return { makeLineTasks, undoLineTasks }
}

const shell = (ui: ReactElement) => (
  <MemoryRouter>
    <ConfirmProvider>
      <ToastProvider>
        <StaticFeaturesProvider value={{ agents: false, ai: false }}>{ui}</StaticFeaturesProvider>
      </ToastProvider>
    </ConfirmProvider>
  </MemoryRouter>
)

function renderEditor(onSaved = vi.fn()) {
  render(
    shell(
      <LibraryEditor projectId={P} item={note()} kind="note" onClose={() => {}} onSaved={onSaved} />
    )
  )
  return screen.getByRole('textbox', { name: /Text/ }) as HTMLTextAreaElement
}

describe('Make a task (N4.4b)', () => {
  it('in the editor: the shortcut on selected lines previews a task from each line', async () => {
    const { makeLineTasks } = install()
    const onSaved = vi.fn()
    const area = renderEditor(onSaved)
    area.focus()
    area.setSelectionRange(BODY.indexOf('- call'), BODY.length)
    fireEvent.keyDown(area, { key: 'K', ctrlKey: true, shiftKey: true })

    const dialog = await screen.findByRole('dialog', { name: 'Make a task' })
    const list = within(dialog).getByRole('list', { name: 'Tasks to make' })
    expect(within(list).getByText('call the venue about parking')).toBeTruthy()
    expect(within(list).getByText('#admin')).toBeTruthy()
    expect(within(list).getByText('send the draft')).toBeTruthy()
    expect(within(list).getByText('High')).toBeTruthy()
    expect(within(list).getAllByText('Backlog')).toHaveLength(2)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Make 2 tasks' }))
    await waitFor(() => expect(makeLineTasks).toHaveBeenCalledTimes(1))
    expect(makeLineTasks.mock.calls[0][1]).toMatchObject({
      itemId: note().id,
      revision: 3,
      body: BODY,
      tasks: [
        { line: 1, title: 'call the venue about parking', labels: ['admin'] },
        { line: 2, title: 'send the draft', priority: 'high' }
      ]
    })
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(area.value).toContain(`](${S}://task/${P}/${T1})`)
    expect(await screen.findByText('Made 2 tasks from the note')).toBeTruthy()
  })

  it('in the editor: the button makes one task from the selection, and undo puts it back', async () => {
    const { makeLineTasks, undoLineTasks } = install()
    const area = renderEditor()
    area.focus()
    area.setSelectionRange(BODY.indexOf('- call'), BODY.length)
    fireEvent.click(screen.getByRole('button', { name: 'Make a task' }))
    const dialog = await screen.findByRole('dialog', { name: 'Make a task' })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'One task' }))
    expect(within(dialog).getByText('1 line of description')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make 1 task' }))
    await waitFor(() => expect(makeLineTasks).toHaveBeenCalledTimes(1))
    expect(makeLineTasks.mock.calls[0][1].tasks).toEqual([
      expect.objectContaining({ line: 1, description: 'send the draft !high' })
    ])

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(undoLineTasks).toHaveBeenCalledTimes(1))
    expect(undoLineTasks).toHaveBeenCalledWith(P, {
      itemId: note().id,
      taskIds: [T1],
      revision: 4,
      body: BODY
    })
    await waitFor(() => expect(area.value).toBe(BODY))
  })

  it('in view mode: a list item offers Make a task for that item alone', async () => {
    const { makeLineTasks } = install()
    const noop = async () => {}
    render(
      shell(
        <LibraryDetail
          item={note()}
          summaryRef={createRef()}
          onUpdate={noop}
          onSetPrimary={noop}
          onEdit={() => {}}
          onOpen={() => {}}
          onArchive={noop}
          onDelete={noop}
          onOpenWorkItem={() => {}}
        />
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Make a task from "send the draft !high"' }))
    const dialog = await screen.findByRole('dialog', { name: 'Make a task' })
    expect(within(dialog).queryByRole('radiogroup')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make 1 task' }))
    await waitFor(() => expect(makeLineTasks).toHaveBeenCalledTimes(1))
    expect(makeLineTasks.mock.calls[0][1].tasks).toEqual([
      expect.objectContaining({ line: 2, title: 'send the draft' })
    ])
  })

  it('afterwards each line shows its task as a chip with its current state', async () => {
    install()
    const noop = async () => {}
    const linked = `- [call the venue](${S}://task/${P}/${T1})\n- [send](${S}://task/${P}/${T2})`
    render(
      shell(
        <LibraryDetail
          item={note(linked)}
          summaryRef={createRef()}
          onUpdate={noop}
          onSetPrimary={noop}
          onEdit={() => {}}
          onOpen={() => {}}
          onArchive={noop}
          onDelete={noop}
          onOpenWorkItem={() => {}}
        />
      )
    )
    expect(await screen.findByText('Call the venue about parking')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Done' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Backlog' })).toBeTruthy()
    // A line that is already a link makes no second task.
    expect(screen.queryByRole('button', { name: /^Make a task from/ })).toBeNull()
  })
})
