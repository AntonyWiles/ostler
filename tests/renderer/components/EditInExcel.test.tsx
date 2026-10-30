// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CsvUpdatePreview, CsvUpdateResult, OstlerAPI } from '@shared/ostler-api'
import { useEditInExcel } from '@renderer/components/excel/useEditInExcel'
import { ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { installOstlerApi } from '../fixtures/ostler-api'

const preview: CsvUpdatePreview = {
  fileName: 'Website tasks.csv',
  encoding: 'utf-8',
  delimiter: ',',
  dateFormat: 'iso',
  hasIdColumn: true,
  changed: [
    {
      line: 2,
      taskId: 't1',
      title: 'Book the venue',
      changes: [{ column: 'due', label: 'Due', from: '2026-10-20', to: '2026-10-22' }],
      problems: [
        { column: 'assignee', label: 'Assignee', text: 'Zed', message: 'Nobody called "Zed"' }
      ]
    },
    {
      line: 3,
      taskId: 't2',
      title: 'Send invites',
      changes: [{ column: 'title', label: 'Title', from: 'Send invites', to: 'Send the invites' }],
      problems: []
    }
  ],
  unchangedCount: 4,
  newRows: [{ line: 5, title: 'Order flowers', errors: [], warnings: [] }],
  newPeople: [],
  newMilestones: [],
  skipped: [{ line: 6, id: 'gone', title: 'Old task', reason: 'unknown' }]
}

const result: CsvUpdateResult = {
  changed: [{ taskId: 't1', title: 'Book the venue', columns: ['due'] }],
  undo: [{ id: 't1', values: { targetDate: '2026-10-20' } }],
  batch: {
    id: 'b1',
    projectId: 'p1',
    source: 'csv',
    fileName: 'Website tasks.csv',
    createdAt: 1,
    itemCount: 1,
    undoneAt: null
  }
}

function Harness({ onChanged }: { onChanged: () => void }) {
  const excel = useEditInExcel('p1', onChanged)
  return (
    <>
      <button type="button" onClick={() => void excel.start({ fileName: 'Website tasks' })}>
        Start
      </button>
      {excel.panel}
    </>
  )
}

function setUp(overrides: Partial<OstlerAPI> = {}) {
  const api = {
    editInExcel: vi.fn(async () => ({
      ok: true as const,
      value: { editId: 'e1', fileName: 'Website tasks.csv', taskCount: 7 }
    })),
    previewBringBack: vi.fn(async () => ({
      ok: true as const,
      value: { fileId: 'f1', preview }
    })),
    applyBringBack: vi.fn(async () => ({ ok: true as const, value: result })),
    restoreTaskValues: vi.fn(async () => ({ ok: true as const, value: 1 })),
    forgetImportFile: vi.fn(async () => ({ ok: true as const, value: undefined })),
    ...overrides
  }
  installOstlerApi(api as Partial<OstlerAPI>)
  const onChanged = vi.fn()
  render(
    <ToastProvider>
      <Harness onChanged={onChanged} />
    </ToastProvider>
  )
  return { api, onChanged }
}

afterEach(() => __resetDismissableStackForTests())

describe('Edit in Excel', () => {
  it('opens the file and shows its panel until Done', async () => {
    const { api } = setUp()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    const panel = await screen.findByRole('region', { name: 'Edit in Excel' })
    expect(api.editInExcel).toHaveBeenCalledWith('p1', { fileName: 'Website tasks' })
    expect(within(panel).getByText('Website tasks.csv')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('region', { name: 'Edit in Excel' })).toBeNull()
  })

  it('shows nothing when the save is cancelled', async () => {
    const { api } = setUp({ editInExcel: vi.fn(async () => ({ ok: true as const, value: null })) })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(api.editInExcel).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Edit in Excel' })).toBeNull()
  })

  it('previews every change, applies the ticked ones, and undoes them in one step', async () => {
    const { api, onChanged } = setUp()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Bring changes back' }))
    const dialog = await screen.findByRole('dialog')
    expect(api.previewBringBack).toHaveBeenCalledWith('p1', 'e1')
    expect(within(dialog).getByText('2026-10-20')).toBeTruthy()
    expect(within(dialog).getByText('2026-10-22')).toBeTruthy()
    expect(within(dialog).getByText('Assignee left as it is: Nobody called "Zed"')).toBeTruthy()
    expect(
      within(dialog).getByText('Row 6, Old task: no task in this project has this ID')
    ).toBeTruthy()
    expect(within(dialog).getByText('2 changed, 1 new, 4 unchanged, 1 left out')).toBeTruthy()

    // Untick Send invites: only Book the venue and the new row are applied.
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Send invites' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    await waitFor(() =>
      expect(api.applyBringBack).toHaveBeenCalledWith('p1', 'f1', {
        taskIds: ['t1'],
        newLines: [5]
      })
    )
    expect(onChanged).toHaveBeenCalled()
    expect(await screen.findByText('Changed 1 task from the sheet')).toBeTruthy()
    expect(screen.getByText('Added 1 new task')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(api.restoreTaskValues).toHaveBeenCalledWith('p1', result.undo))
  })

  it('lets a file go when the preview is cancelled, and reads another the person picks', async () => {
    const { api } = setUp()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Another file…' }))
    const dialog = await screen.findByRole('dialog')
    expect(api.previewBringBack).toHaveBeenCalledWith('p1', null)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(api.forgetImportFile).toHaveBeenCalledWith('f1')
    expect(api.applyBringBack).not.toHaveBeenCalled()
  })

  it('says to close the file when Excel holds it', async () => {
    setUp({
      previewBringBack: vi.fn(async () => ({
        ok: false as const,
        error: 'Close the file in Excel, then try again'
      }))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Bring changes back' }))
    expect(await screen.findByText('Close the file in Excel, then try again')).toBeTruthy()
  })
})
