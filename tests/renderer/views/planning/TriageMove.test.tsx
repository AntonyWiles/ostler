// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RendererProject, TriageMoveResult } from '@shared/ostler-api'
import { TriageDialogs } from '@renderer/views/planning/triage/TriageDialogs'
import { ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { makeWorkItem } from '../../fixtures/planning-records'
import { installOstlerApi } from '../../fixtures/ostler-api'

function project(id: string, name: string, triageCaptures: boolean): RendererProject {
  return {
    id,
    name,
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: 0,
    lastActivity: null,
    hasAutomationToken: false,
    triageCaptures
  } as RendererProject
}

const projects = [
  project('p1', 'Website', true),
  project('p2', 'Garden', false),
  project('p3', 'Office', true)
]

vi.mock('@renderer/context/OstlerContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@renderer/context/OstlerContext')>()),
  useProjectList: () => projects
}))

const onUndone = vi.fn()

const ITEM = makeWorkItem('a', { title: 'Weed the beds', inTriage: true, capturedBy: 'quick-add' })

function renderMove(landsInTriage: boolean) {
  const move: TriageMoveResult = {
    workItem: makeWorkItem('new', {
      projectId: landsInTriage ? 'p3' : 'p2',
      inTriage: landsInTriage
    }),
    movedFromId: 'a',
    copiedItemIds: []
  }
  const moveTriagedWorkItem = vi.fn(async () => ({ ok: true as const, value: move }))
  const undoTriageMove = vi.fn(async () => ({ ok: true as const, value: ITEM }))
  installOstlerApi({ moveTriagedWorkItem, undoTriageMove })
  render(
    <ToastProvider>
      <TriageDialogs
        dialog={{ kind: 'move', item: ITEM, index: 0 }}
        projectId="p1"
        workItems={[ITEM]}
        onClose={vi.fn()}
        onDone={vi.fn()}
        onUndone={onUndone}
      />
    </ToastProvider>
  )
  return { move, moveTriagedWorkItem, undoTriageMove }
}

describe('Move to project from To triage', () => {
  beforeEach(() => {
    __resetDismissableStackForTests()
    onUndone.mockReset()
  })

  it('says the task lands in the Backlog of a project that does not triage, and offers undo', async () => {
    const { move, moveTriagedWorkItem, undoTriageMove } = renderMove(false)
    const select = screen.getByLabelText('Project')
    fireEvent.change(select, { target: { value: 'p2' } })
    expect(
      screen.getByText(/That project doesn’t triage new captures, so it goes into its Backlog/)
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(moveTriagedWorkItem).toHaveBeenCalledWith('p1', 'a', 'p2'))
    expect(await screen.findByText('Moved “Weed the beds” to Garden’s Backlog')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(undoTriageMove).toHaveBeenCalledWith('p1', move))
  })

  it('tells To triage once the move is undone, so it reads the task back', async () => {
    const { undoTriageMove } = renderMove(false)
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(onUndone).toHaveBeenCalledTimes(1))
    expect(undoTriageMove).toHaveBeenCalledTimes(1)
  })

  it('says the task waits in the To triage of a project that triages', async () => {
    const { moveTriagedWorkItem } = renderMove(true)
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p3' } })
    expect(screen.getByText(/^It waits in that project’s To triage\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(moveTriagedWorkItem).toHaveBeenCalledWith('p1', 'a', 'p3'))
    expect(
      await screen.findByText('Moved “Weed the beds” to Office’s To triage')
    ).toBeInTheDocument()
  })
})
