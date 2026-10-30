// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangeHistoryEntry } from '@shared/ostler-api'
import { UndoHistoryView } from '@renderer/views/undo-history/UndoHistoryView'
import { ChangeHistoryProvider } from '@renderer/history/ChangeHistoryProvider'
import { UndoRedoControls } from '@renderer/history/UndoRedoControls'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'

const NOW = Date.now()

function entry(partial: Partial<ChangeHistoryEntry> & { id: string }): ChangeHistoryEntry {
  return {
    at: NOW,
    lastAt: NOW,
    kind: 'change',
    projectId: null,
    subjects: [
      {
        kind: 'task',
        id: 't1',
        projectId: null,
        name: 'Paint the hall',
        action: 'changed',
        fields: ['title', 'target_date']
      }
    ],
    subjectCount: 1,
    undoesId: null,
    undoneById: null,
    ...partial
  }
}

function renderWithShell(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>
          <ChangeHistoryProvider>{ui}</ChangeHistoryProvider>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>
  )
}

describe('undo history', () => {
  let undoChange: ReturnType<typeof vi.fn>
  let undoLatestChange: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const rename = entry({ id: 'e1' })
    const undone = entry({
      id: 'e2',
      lastAt: NOW - 60_000,
      undoneById: 'e3',
      subjects: [
        {
          kind: 'milestone',
          id: 'm1',
          projectId: null,
          name: 'Launch',
          action: 'removed',
          fields: []
        }
      ]
    })
    undoChange = vi.fn(async () => ({
      ok: true as const,
      value: { entry: entry({ id: 'u1', kind: 'undo', undoesId: 'e1' }), reverted: 1, kept: 0 }
    }))
    undoLatestChange = vi.fn(async () => ({
      ok: true as const,
      value: { entry: entry({ id: 'u2', kind: 'undo', undoesId: 'e1' }), reverted: 1, kept: 2 }
    }))
    installOstlerApi({
      listChangeHistory: async () => ({
        ok: true,
        value: { entries: [rename, undone], nextBefore: null }
      }),
      getChangeHistoryStats: async () => ({
        ok: true,
        value: { entries: 2, oldestAt: NOW, bytes: 2048 }
      }),
      getChangeHistoryHead: async () => ({ ok: true, value: { undo: rename, redo: null } }),
      getConfig: async () => ({ ok: true, value: RENDERER_DEFAULT_CONFIG }),
      undoChange,
      undoLatestChange
    })
  })

  it('lists steps by day, in words, with Undo or Redo on each', async () => {
    renderWithShell(<UndoHistoryView />)
    expect(await screen.findByText('Changed task “Paint the hall”')).toBeTruthy()
    expect(screen.getByText('Title and due date')).toBeTruthy()
    expect(screen.getByText('Deleted milestone “Launch”')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy()
    expect(screen.getByText('Undone')).toBeTruthy()
    // The header's Redo, then the undone step's own.
    expect(screen.getAllByRole('button', { name: 'Redo' })).toHaveLength(2)

    const undoButtons = screen.getAllByRole('button', { name: 'Undo' })
    // The header's Undo, then the step's own.
    fireEvent.click(undoButtons[undoButtons.length - 1])
    await waitFor(() => expect(undoChange).toHaveBeenCalledWith('e1'))
    expect(await screen.findByText('Undone: Changed task “Paint the hall”')).toBeTruthy()
  })

  it('names the step Undo would take back, and says when later changes were kept', async () => {
    renderWithShell(<UndoRedoControls />)
    const undo = await screen.findByRole('button', {
      name: 'Undo: Changed task “Paint the hall”'
    })
    expect(screen.getByRole('button', { name: 'Nothing to redo' })).toHaveProperty('disabled', true)
    fireEvent.click(undo)
    await waitFor(() => expect(undoLatestChange).toHaveBeenCalled())
    expect(await screen.findByText('2 later changes were kept.')).toBeTruthy()
  })

  it('undoes the newest step on Ctrl+Z outside a text field', async () => {
    renderWithShell(<UndoRedoControls />)
    await screen.findByRole('button', { name: 'Undo: Changed task “Paint the hall”' })
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(undoLatestChange).toHaveBeenCalledTimes(1))
  })
})
