// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type {
  CsvImportOptions,
  CsvImportPreview,
  ImportRequest,
  ImportResult,
  ImportTarget,
  InboxList,
  RendererProject
} from '@shared/ostler-api'
import { ImportDialog } from '@renderer/components/import/ImportDialog'
import { NewProjectWizard } from '@renderer/components/NewProjectWizard'
import { InboxView } from '@renderer/views/inbox/InboxView'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'
import { withElementSize } from '../fixtures/layout'

const website = {
  id: 'web',
  name: 'Website',
  path: null,
  color: '#3b82f6',
  enabled: true,
  customIgnorePatterns: [],
  notes: '',
  tags: [],
  addedAt: 0,
  lastActivity: null,
  hasAutomationToken: false
} as RendererProject

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [website], loading: false, refreshProjects: async () => {} })
}))

function preview(options: CsvImportOptions, detected: 'asana' | null = null): CsvImportPreview {
  return {
    encoding: options.encoding ?? 'windows-1252',
    delimiter: options.delimiter ?? ';',
    dateFormat: options.dateFormat ?? 'dmy',
    headers: ['Summary', 'Status', 'Due Date'],
    preset: options.preset === 'none' ? null : (options.preset ?? detected),
    detectedPreset: detected,
    subtaskCount: detected ? 1 : 0,
    dependencyCount: detected ? 2 : 0,
    customColumns: [],
    newFields: [],
    existingFields: [],
    columns: {
      title: 0,
      description: null,
      status: 1,
      priority: null,
      assignee: null,
      labels: null,
      start: null,
      due: 2,
      estimate: null,
      milestone: null,
      iteration: null,
      type: null,
      showFrom: null,
      someday: null,
      checklist: null,
      key: null,
      parent: null,
      waitsOn: null,
      blocks: null,
      done: null,
      ...options.columns
    },
    statuses: [{ value: 'Doing', count: 2, mapped: options.statusMap?.Doing ?? 'active' }],
    priorities: [],
    rowCount: 3,
    importableCount: 2,
    errorRowCount: 1,
    warningRowCount: 1,
    errorCount: 1,
    warningCount: 1,
    newMilestones: [],
    newPeople: [],
    rows: [
      {
        line: 2,
        title: 'Café opening',
        cells: { status: 'Doing', due: '20/10/2026' },
        errors: [],
        warnings: []
      },
      {
        line: 3,
        title: 'Naïve plan',
        cells: { status: 'Doing', due: 'soon' },
        errors: [],
        warnings: [
          {
            field: 'due',
            message: '“soon” is not a date in the chosen format, so it is left empty'
          }
        ]
      },
      {
        line: 4,
        title: '',
        cells: { status: '', due: '' },
        errors: [{ field: 'title', message: 'The title is empty' }],
        warnings: []
      }
    ]
  }
}

function wrap(element: React.ReactNode) {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <MemoryRouter>{element}</MemoryRouter>
      </ConfirmProvider>
    </ToastProvider>
  )
}

function installImportApi(detected: 'asana' | null = null) {
  const previews: CsvImportOptions[] = []
  const runs: { request: ImportRequest; target: ImportTarget }[] = []
  const api = installOstlerApi({
    pickImportFile: async () => ({
      ok: true,
      value: { fileId: 'f1', fileName: 'Excel export.csv', kind: 'csv', sizeBytes: 120 }
    }),
    previewCsvImport: async (_fileId, options) => {
      previews.push(options)
      return { ok: true, value: preview(options, detected) }
    },
    runImport: async (_fileId, request, target) => {
      runs.push({ request, target })
      return {
        ok: true,
        value: {
          batch: {
            id: 'b1',
            projectId: 'new',
            source: 'csv',
            fileName: 'Excel export.csv',
            createdAt: 0,
            itemCount: 2,
            undoneAt: null
          },
          projectId: 'new',
          projectName: 'Café',
          skipped: 1,
          warnings: []
        } satisfies ImportResult
      }
    },
    forgetImportFile: async () => ({ ok: true, value: undefined })
  })
  return { api, previews, runs }
}

describe('ImportDialog', () => {
  // The preview is a virtualised DataTable: give it room for every row.
  withElementSize(1200, 800)

  it('maps columns and values, previews the rows with their problems, then imports', async () => {
    const { previews, runs } = installImportApi()
    const onImported = vi.fn()
    wrap(<ImportDialog target={{ kind: 'new' }} onClose={vi.fn()} onImported={onImported} />)

    fireEvent.click(screen.getByRole('button', { name: 'Choose a file…' }))
    await screen.findByText('Excel export.csv')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    // Mapping: the guesses show, and changing one previews again.
    const title = await screen.findByLabelText('Title (required)')
    expect(title).toHaveValue('0')
    expect(screen.getByLabelText('Encoding')).toHaveValue('windows-1252')
    expect(screen.getByLabelText('Separator')).toHaveValue(';')
    fireEvent.change(screen.getByLabelText('Status “Doing” (2)'), { target: { value: 'review' } })
    await waitFor(() => expect(previews.at(-1)?.statusMap).toEqual({ Doing: 'review' }))
    fireEvent.change(screen.getByLabelText('Dates are written'), { target: { value: 'mdy' } })
    await waitFor(() => expect(previews.at(-1)?.dateFormat).toBe('mdy'))

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText(/with errors will be skipped/)).toBeInTheDocument()
    const grid = screen.getByRole('grid', { name: 'Import preview' })
    expect(within(grid).getByText('Naïve plan')).toBeInTheDocument()
    expect(within(grid).getAllByText(/Warning: “soon” is not a date/).length).toBeGreaterThan(0)
    expect(within(grid).getAllByText(/Error: The title is empty/).length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Café' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 tasks' }))
    await waitFor(() => expect(onImported).toHaveBeenCalled())
    expect(runs[0].target).toEqual({ kind: 'new', name: 'Café' })
    expect(runs[0].request).toMatchObject({
      kind: 'csv',
      options: { statusMap: { Doing: 'review' }, dateFormat: 'mdy' }
    })
  })

  it('says which tool an export is from, and maps it by hand on request (R4.2)', async () => {
    const { previews } = installImportApi('asana')
    wrap(<ImportDialog target={{ kind: 'new' }} onClose={vi.fn()} onImported={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose a file…' }))
    await screen.findByText('Excel export.csv')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText(/This looks like an export from Asana/)).toBeInTheDocument()
    const from = screen.getByLabelText('Exported from')
    expect(from).toHaveValue('asana')
    fireEvent.change(screen.getByLabelText('Status “Doing” (2)'), { target: { value: 'review' } })
    await waitFor(() => expect(previews.at(-1)?.statusMap).toEqual({ Doing: 'review' }))

    // Mapping by hand starts the mapping again, without the preset.
    fireEvent.change(from, { target: { value: 'none' } })
    await waitFor(() => expect(previews.at(-1)).toMatchObject({ preset: 'none' }))
    expect(previews.at(-1)?.statusMap).toBeUndefined()
    await waitFor(() => expect(screen.queryByText(/This looks like/)).not.toBeInTheDocument())
    expect(screen.getByLabelText('Exported from')).toHaveValue('none')

    fireEvent.change(screen.getByLabelText('Exported from'), { target: { value: 'asana' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }))
    expect(
      await screen.findByText('The import makes 1 subtask and 2 Waits on links.')
    ).toBeInTheDocument()
  })

  it('imports into the project it was opened from', async () => {
    const { runs } = installImportApi()
    wrap(
      <ImportDialog
        target={{ kind: 'project', projectId: 'web' }}
        onClose={vi.fn()}
        onImported={vi.fn()}
      />
    )
    expect(screen.getByRole('dialog', { name: 'Import tasks into Website' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Choose a file…' }))
    await screen.findByText('Excel export.csv')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText('Title (required)')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.queryByLabelText('Project name')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Import 2 tasks' }))
    await waitFor(() => expect(runs).toHaveLength(1))
    expect(runs[0].target).toEqual({ kind: 'project', projectId: 'web' })
  })

  it('turns a project file into a new project', async () => {
    const { runs } = installImportApi()
    window.ostlerAPI.pickImportFile = async () => ({
      ok: true,
      value: {
        fileId: 'f2',
        fileName: 'Party.ostler-project',
        kind: 'package',
        sizeBytes: 0,
        packageSummary: {
          name: 'Party',
          milestoneCount: 2,
          taskCount: 6,
          fileCount: 1,
          isTemplate: false
        }
      }
    })
    wrap(<ImportDialog target={{ kind: 'new' }} onClose={vi.fn()} onImported={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose a file…' }))
    await screen.findByText('Party.ostler-project')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText(/2 milestones, 6 tasks and 1 Library file/)).toBeInTheDocument()
    expect(screen.getByLabelText('Project name')).toHaveValue('Party')
    fireEvent.click(screen.getByRole('button', { name: 'Import project' }))
    await waitFor(() => expect(runs).toHaveLength(1))
    expect(runs[0].request).toEqual({ kind: 'package' })
  })

  it('asks for a protected project file’s password, and tries again after a wrong one (N45)', async () => {
    const { runs } = installImportApi()
    const tried: string[] = []
    window.ostlerAPI.pickImportFile = async () => ({
      ok: true,
      value: {
        fileId: 'locked',
        fileName: 'Secret.ostler-project',
        kind: 'package',
        sizeBytes: 0,
        locked: true
      }
    })
    window.ostlerAPI.unlockImportFile = async (fileId, password) => {
      tried.push(`${fileId}:${password}`)
      if (password !== 'correct horse')
        return { ok: false, error: 'This password does not open the file, or the file is damaged.' }
      return {
        ok: true,
        value: {
          fileId: 'open',
          fileName: 'Secret.ostler-project',
          kind: 'package',
          sizeBytes: 0,
          packageSummary: {
            name: 'Secret',
            milestoneCount: 0,
            taskCount: 3,
            fileCount: 0,
            isTemplate: false
          }
        }
      }
    }
    wrap(<ImportDialog target={{ kind: 'new' }} onClose={vi.fn()} onImported={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose a file…' }))
    await screen.findByText('Secret.ostler-project')
    expect(screen.getByText(/protected with a password/)).toBeInTheDocument()
    const next = screen.getByRole('button', { name: 'Next' })
    expect(next).toBeDisabled()

    const field = screen.getByLabelText('Password')
    expect(field).toHaveAttribute('type', 'password')
    fireEvent.change(field, { target: { value: 'wrong horse' } })
    fireEvent.click(next)
    expect(
      await screen.findByText('This password does not open the file, or the file is damaged.')
    ).toBeInTheDocument()
    // The field is cleared after each try.
    expect(screen.getByLabelText('Password')).toHaveValue('')

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByLabelText('Project name')).toHaveValue('Secret')
    expect(tried).toEqual(['locked:wrong horse', 'locked:correct horse'])
    fireEvent.click(screen.getByRole('button', { name: 'Import project' }))
    await waitFor(() => expect(runs).toHaveLength(1))
  })

  it('proposes a free name when a project already has the file’s, and says why', async () => {
    const { runs } = installImportApi()
    const picked: string[] = []
    window.ostlerAPI.pickImportFile = async (mode) => {
      picked.push(mode)
      return {
        ok: true,
        value: {
          fileId: 'f3',
          fileName: 'Website',
          kind: 'package',
          sizeBytes: 0,
          packageSummary: {
            name: 'Website',
            milestoneCount: 0,
            taskCount: 1,
            fileCount: 0,
            isTemplate: false
          }
        }
      }
    }
    wrap(<ImportDialog target={{ kind: 'new' }} onClose={vi.fn()} onImported={vi.fn()} />)
    // An export folder from an earlier version is the quieter second choice.
    fireEvent.click(
      screen.getByRole('button', { name: 'Import an export folder from an earlier version…' })
    )
    await screen.findByText('Website')
    expect(picked).toEqual(['folder'])
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    const field = screen.getByLabelText('Project name')
    expect(field).toHaveValue('Website (2)')
    expect(field).toHaveAccessibleDescription(/already called “Website”/)
    // Typing the taken name back warns, and does not block.
    fireEvent.change(field, { target: { value: 'website' } })
    expect(field).toHaveAccessibleDescription(/Another project already has this name/)
    fireEvent.click(screen.getByRole('button', { name: 'Import project' }))
    await waitFor(() => expect(runs).toHaveLength(1))
    expect(runs[0].target).toEqual({ kind: 'new', name: 'website' })
  })
})

describe('the New project wizard', () => {
  it('offers "Import into a new project" and hands over to the import dialog', async () => {
    installImportApi()
    Object.assign(window.ostlerAPI, {
      getNewProjectDefaults: async () => ({
        ok: true,
        value: {
          parentPath: 'C:\\projects',
          gitAvailable: true,
          gitIdentityConfigured: true,
          colors: ['#3b82f6']
        }
      }),
      listProjectTemplates: async () => ({ ok: true, value: [] })
    })
    wrap(<NewProjectWizard onClose={vi.fn()} onCreated={vi.fn()} onOpen={vi.fn()} />)
    const option = screen.getByRole('radio', { name: 'Import into a new project' })
    expect(option).toHaveProperty('disabled', false)
    fireEvent.click(option)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('dialog', { name: 'Import' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose a file…' })).toBeInTheDocument()
  })
})

describe('the Inbox', () => {
  it('offers Undo import, keeps changed tasks unless confirmed, and can bring them back', async () => {
    const inbox: InboxList = {
      unreadCount: 1,
      items: [
        {
          key: 'import:b1',
          kind: 'import',
          title: 'Imported 3 tasks into Website',
          body: 'From tasks.csv',
          projectId: 'web',
          taskId: null,
          createdAt: Date.now(),
          readAt: null
        }
      ]
    }
    const undoImport = vi.fn(async (_batchId: string, includeChanged: boolean) => ({
      ok: true as const,
      value: {
        batch: {
          id: 'b1',
          projectId: 'web',
          source: 'csv' as const,
          fileName: 'tasks.csv',
          createdAt: 0,
          itemCount: 3,
          undoneAt: 1
        },
        movedIds: includeChanged ? ['t1', 't2', 't3'] : ['t1', 't2'],
        kept: includeChanged ? [] : [{ id: 't3', title: 'Launch' }]
      }
    }))
    const restoreImport = vi.fn(async () => ({ ok: true as const, value: {} as never }))
    installOstlerApi({
      getInbox: async () => ({ ok: true, value: inbox }),
      checkUndoImport: async () => ({
        ok: true,
        value: {
          batch: {} as never,
          taskCount: 3,
          changed: [{ id: 't3', title: 'Launch' }]
        }
      }),
      undoImport,
      restoreImport
    })
    wrap(<InboxView />)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo import' }))
    // Launch changed since: asked, and kept.
    const question = await screen.findByRole('alertdialog')
    expect(within(question).getByText(/Launch/)).toBeInTheDocument()
    fireEvent.click(within(question).getByRole('button', { name: 'Keep them' }))
    await waitFor(() => expect(undoImport).toHaveBeenCalledWith('b1', false))
    expect(await screen.findByText('Moved 2 imported tasks to the recycle bin')).toBeInTheDocument()
    expect(screen.getByText('Kept 1 changed task.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(restoreImport).toHaveBeenCalledWith('b1', ['t1', 't2']))
  })
})
