import { app, dialog, shell, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  CalendarExportOptions,
  CsvImportOptions,
  CsvUpdateApplyRequest,
  ImportRequest,
  ImportTarget,
  MyWeekPrintRequest,
  PrintRequest,
  TimelineOverviewPrintRequest,
  RoundComparisonPrintRequest,
  ProjectExportOptions,
  ShareReportOptions,
  TaskCsvExportRequest,
  TaskValuesRestore,
  TimelineSlidesExportOptions,
  TrelloImportOptions,
  WatchedProject,
  YearInReviewPrintRequest
} from '@shared/ostler-api'
import { MAX_IMPORT_FILE_BYTES } from '@shared/import/import-plan'
import {
  isPrintableView,
  myWeekHashPath,
  printHashPath,
  roundsHashPath,
  timelineOverviewHashPath,
  yearInReviewHashPath
} from '@shared/print-route'
import { isRoundMeasure, roundComparisonCsv } from '@shared/export/rounds-csv'
import { formatIsoDate } from '@shared/dates'
import type { ImportService } from '../services/import-service'
import type { PlanningService } from '../services/planning-service'
import type { ProjectPackageService } from '../services/project-package-service'
import type { ProjectRuntimeController } from '../services/project-runtime-controller'
import {
  buildProjectCalendarFile,
  buildProjectShareReport,
  buildProjectTimelineSlides,
  buildTasksCsv
} from '../services/export-service'
import type { ReportService } from '../services/report-service'
import { pdfOf, printContents, renderPrintWindow } from '../app/print-window'
import { safeFileName } from '../app/file-names'
import { handleApi } from './handle-ipc'
import { t } from '@shared/i18n'

export interface ImportHandlerDependencies {
  importService: ImportService
  projectPackageService: ProjectPackageService
  planningService: PlanningService
  /** The Overview's key numbers, for the shareable report. */
  getReportService(): ReportService
  runtimeController: ProjectRuntimeController
  getMainWindow(): BrowserWindow | null
  getProject(projectId: string): WatchedProject
  /** After an import or an undo: Board, Home and the Inbox read again. */
  notifyPlanningChanged(projectId: string): void
  /** An import started or finished: the taskbar shows it (P8.2). */
  importProgress?(running: boolean): void
}

const VIEW_NAMES: Record<PrintRequest['view'], string> = {
  list: 'List',
  overview: 'Overview',
  timeline: 'Timeline',
  shopping: 'Shopping list'
}

/**
 * Import, export and print (P6.1). Main shows every file dialog and reads
 * and writes every file itself; the renderer only ever holds a file id.
 * Nothing is written anywhere but the place the person picks.
 */
export function registerImportHandlers(deps: ImportHandlerDependencies): void {
  const { importService, planningService, getProject } = deps

  const window = () => {
    const main = deps.getMainWindow()
    if (!main) throw new Error('Main window is not available')
    return main
  }

  /**
   * The one save dialog for every export, print and edit. Its button says what
   * the action is called: Save for Save as PDF and Edit in Excel, Export for
   * an export.
   */
  const saveTo = async (
    title: string,
    buttonLabel: string,
    defaultName: string,
    filters: Electron.FileFilter[]
  ) => {
    const choice = await dialog.showSaveDialog(window(), {
      title,
      buttonLabel,
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters,
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    return choice.canceled || !choice.filePath ? null : choice.filePath
  }

  handleApi('pickImportFile', async (_event, mode: 'file' | 'folder') => {
    const folder = mode === 'folder'
    const choice = await dialog.showOpenDialog(window(), {
      title: folder
        ? t('errors:importHandlers.chooseEarlierExportFolder')
        : t('errors:importHandlers.chooseFileImport'),
      buttonLabel: 'Choose',
      properties: folder ? ['openDirectory'] : ['openFile'],
      filters: folder
        ? undefined
        : [
            {
              name: t('errors:importHandlers.spreadsheetsTrelloBoardsProjects'),
              extensions: ['ostler-project', 'nexus-project', 'csv', 'tsv', 'txt', 'json']
            },
            { name: t('errors:importHandlers.allFiles'), extensions: ['*'] }
          ]
    })
    const chosen = choice.filePaths[0]
    if (choice.canceled || !chosen) return null
    return folder ? importService.readFolder(chosen) : importService.readFile(chosen)
  })
  handleApi('forgetImportFile', (_event, fileId: string) => importService.forgetFile(fileId))
  handleApi('unlockImportFile', (_event, fileId: string, password: string) =>
    importService.unlockFile(fileId, typeof password === 'string' ? password : '')
  )
  handleApi(
    'previewCsvImport',
    (_event, fileId: string, options: CsvImportOptions, projectId: string | null) =>
      importService.previewCsv(fileId, options, projectId)
  )
  handleApi(
    'previewTrelloImport',
    (_event, fileId: string, options: TrelloImportOptions, projectId: string | null) =>
      importService.previewTrello(fileId, options, projectId)
  )
  handleApi(
    'runImport',
    async (_event, fileId: string, request: ImportRequest, target: ImportTarget) => {
      if (target?.kind === 'project') getProject(target.projectId)
      deps.importProgress?.(true)
      const result = await importService
        .runImport(fileId, request, target)
        .finally(() => deps.importProgress?.(false))
      // A new project starts like one the wizard made.
      if (target?.kind !== 'project') deps.runtimeController.start(getProject(result.projectId))
      deps.notifyPlanningChanged(result.projectId)
      return result
    }
  )
  handleApi('listImportBatches', () => importService.listBatches())
  handleApi('checkUndoImport', (_event, batchId: string) => importService.checkUndo(batchId))
  handleApi('undoImport', (_event, batchId: string, includeChanged: boolean) => {
    const result = importService.undo(
      batchId,
      includeChanged === true,
      planningService.humanActor()
    )
    deps.notifyPlanningChanged(result.batch.projectId)
    return result
  })
  handleApi('restoreImport', (_event, batchId: string, taskIds: string[]) => {
    const batch = importService.restore(batchId, taskIds, planningService.humanActor())
    deps.notifyPlanningChanged(batch.projectId)
    return batch
  })

  handleApi('exportProject', async (_event, projectId: string, options: ProjectExportOptions) => {
    const project = getProject(projectId)
    const chosen = await saveTo(
      t('errors:importHandlers.export', { projectName: project.name }),
      t('errors:importHandlers.exportButton'),
      `${safeFileName(project.name)}.ostler-project`,
      [{ name: t('errors:importHandlers.projectFile'), extensions: ['ostler-project'] }]
    )
    if (!chosen) return null
    const filePath = /\.ostler-project$/i.test(chosen) ? chosen : `${chosen}.ostler-project`
    deps.projectPackageService.exportProjectFile(projectId, filePath, {
      comments: options?.comments !== false,
      password: typeof options?.password === 'string' ? options.password : undefined
    })
    return filePath
  })

  handleApi('exportTasksCsv', async (_event, projectId: string, request: TaskCsvExportRequest) => {
    const project = getProject(projectId)
    const { text } = buildTasksCsv(planningService, project, request)
    const chosen = await saveTo(
      t('errors:importHandlers.exportTasksCsv'),
      t('errors:importHandlers.exportButton'),
      `${safeFileName(request?.fileName || `${project.name} tasks`)}.csv`,
      [{ name: 'CSV (comma separated)', extensions: ['csv'] }]
    )
    if (!chosen) return null
    fs.writeFileSync(chosen, text, 'utf8')
    return chosen
  })

  // Edit in Excel (N2.8): main keeps each file's path; the renderer holds an id.
  const editFiles = new Map<string, { projectId: string; filePath: string }>()

  handleApi('editInExcel', async (_event, projectId: string, request: TaskCsvExportRequest) => {
    const project = getProject(projectId)
    const { text, taskCount } = buildTasksCsv(planningService, project, {
      ...request,
      withIds: true
    })
    const chosen = await saveTo(
      t('errors:importHandlers.editInExcel'),
      t('errors:importHandlers.saveButton'),
      `${safeFileName(request?.fileName || `${project.name} tasks`)}.csv`,
      [{ name: 'CSV (comma separated)', extensions: ['csv'] }]
    )
    if (!chosen) return null
    const filePath = /\.csv$/i.test(chosen) ? chosen : `${chosen}.csv`
    try {
      fs.writeFileSync(filePath, text, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES')
        throw new Error(t('errors:importService.closeInExcel'))
      throw error
    }
    const editId = randomUUID()
    editFiles.set(editId, { projectId, filePath })
    const error = await shell.openPath(filePath)
    if (error) throw new Error(error)
    return { editId, fileName: path.basename(filePath), taskCount }
  })
  handleApi('previewBringBack', async (_event, projectId: string, editId: string | null) => {
    getProject(projectId)
    let filePath: string
    if (editId === null) {
      const choice = await dialog.showOpenDialog(window(), {
        title: t('errors:importHandlers.bringChangesBack'),
        buttonLabel: 'Choose',
        defaultPath: app.getPath('documents'),
        properties: ['openFile'],
        filters: [
          { name: 'CSV', extensions: ['csv', 'tsv', 'txt'] },
          { name: t('errors:importHandlers.allFiles'), extensions: ['*'] }
        ]
      })
      const chosen = choice.filePaths[0]
      if (choice.canceled || !chosen) return null
      filePath = chosen
    } else {
      const held = typeof editId === 'string' ? editFiles.get(editId) : undefined
      if (!held || held.projectId !== projectId)
        throw new Error(t('errors:importService.editFileGone'))
      filePath = held.filePath
    }
    const file = importService.readEditFile(filePath)
    try {
      return {
        fileId: file.fileId,
        preview: importService.previewCsvUpdate(file.fileId, projectId)
      }
    } catch (error) {
      importService.forgetFile(file.fileId)
      throw error
    }
  })
  handleApi(
    'applyBringBack',
    (_event, projectId: string, fileId: string, request: CsvUpdateApplyRequest) => {
      getProject(projectId)
      const result = importService.applyCsvUpdate(
        fileId,
        projectId,
        request ?? {},
        planningService.humanActor()
      )
      deps.notifyPlanningChanged(projectId)
      return result
    }
  )
  handleApi('restoreTaskValues', (_event, projectId: string, restores: TaskValuesRestore[]) => {
    getProject(projectId)
    const count = importService.restoreTaskValues(projectId, restores, planningService.humanActor())
    deps.notifyPlanningChanged(projectId)
    return count
  })

  handleApi(
    'exportCalendarFile',
    async (_event, projectId: string, options: CalendarExportOptions) => {
      const project = getProject(projectId)
      const { text } = buildProjectCalendarFile(planningService, project, options)
      const chosen = await saveTo(
        t('errors:importHandlers.exportCalendarFile'),
        t('errors:importHandlers.exportButton'),
        `${safeFileName(project.name)}.ics`,
        [{ name: t('errors:importHandlers.calendarFile'), extensions: ['ics'] }]
      )
      if (!chosen) return null
      const filePath = /\.ics$/i.test(chosen) ? chosen : `${chosen}.ics`
      fs.writeFileSync(filePath, text, 'utf8')
      return filePath
    }
  )

  handleApi(
    'exportTimelineSlides',
    async (_event, projectId: string, options: TimelineSlidesExportOptions) => {
      const project = getProject(projectId)
      const { bytes } = buildProjectTimelineSlides(planningService, project, options)
      const chosen = await saveTo(
        t('errors:importHandlers.exportTimelineSlides'),
        t('errors:importHandlers.exportButton'),
        `${safeFileName(`${project.name} timeline`)}.pptx`,
        [{ name: t('errors:importHandlers.powerPointFile'), extensions: ['pptx'] }]
      )
      if (!chosen) return null
      const filePath = /\.pptx$/i.test(chosen) ? chosen : `${chosen}.pptx`
      fs.writeFileSync(filePath, bytes)
      return filePath
    }
  )

  handleApi('exportShareReport', async (_event, projectId: string, options: ShareReportOptions) => {
    const project = getProject(projectId)
    const html = buildProjectShareReport(planningService, deps.getReportService(), project, options)
    const chosen = await saveTo(
      t('errors:importHandlers.shareWebPage'),
      t('errors:importHandlers.exportButton'),
      `${safeFileName(project.name)}.html`,
      [{ name: t('errors:importHandlers.webPage'), extensions: ['html', 'htm'] }]
    )
    if (!chosen) return null
    const filePath = /\.html?$/i.test(chosen) ? chosen : `${chosen}.html`
    fs.writeFileSync(filePath, html, 'utf8')
    return filePath
  })

  handleApi('printProjectView', async (_event, projectId: string, request: PrintRequest) => {
    const project = getProject(projectId)
    if (!isPrintableView(request?.view))
      throw new Error('Only List, Overview, Timeline and Shopping list print')
    if (request.output === 'printer') {
      await renderPrintWindow(printHashPath(projectId, request), printContents)
      return null
    }
    const chosen = await saveTo(
      t('errors:importHandlers.savePdf'),
      t('errors:importHandlers.saveButton'),
      `${safeFileName(`${project.name} - ${VIEW_NAMES[request.view]}`)}.pdf`,
      [{ name: 'PDF', extensions: ['pdf'] }]
    )
    if (!chosen) return null
    const pdf = await renderPrintWindow(printHashPath(projectId, request), (contents) =>
      pdfOf(contents, app.getLocale())
    )
    fs.writeFileSync(chosen, pdf)
    return chosen
  })

  // Print my week (N3.1b): Home's lists on one sheet, from the renderer's local date.
  handleApi('printMyWeek', async (_event, request: MyWeekPrintRequest) => {
    const hash = myWeekHashPath(request?.today)
    if (request.output === 'printer') {
      await renderPrintWindow(hash, printContents)
      return null
    }
    const chosen = await saveTo(
      t('errors:importHandlers.savePdf'),
      t('errors:importHandlers.saveButton'),
      `${safeFileName(
        t('errors:importHandlers.myWeekFile', {
          date: formatIsoDate(request.today, { day: 'numeric', month: 'long' })
        })
      )}.pdf`,
      [{ name: 'PDF', extensions: ['pdf'] }]
    )
    if (!chosen) return null
    const pdf = await renderPrintWindow(hash, (contents) => pdfOf(contents, app.getLocale()))
    fs.writeFileSync(chosen, pdf)
    return chosen
  })

  // Print Your year (N3.6): the year's finished work on A4 portrait, for the person only.
  handleApi('printYearInReview', async (_event, request: YearInReviewPrintRequest) => {
    if (!request || (request.output !== 'pdf' && request.output !== 'printer'))
      throw new Error('Choose a printer or a PDF')
    const hash = yearInReviewHashPath({ year: request.year, weekStart: request.weekStart })
    if (request.output === 'printer') {
      await renderPrintWindow(hash, printContents)
      return null
    }
    const chosen = await saveTo(
      t('errors:importHandlers.savePdf'),
      t('errors:importHandlers.saveButton'),
      `${safeFileName(t('errors:importHandlers.yearInReviewFile', { year: request.year }))}.pdf`,
      [{ name: 'PDF', extensions: ['pdf'] }]
    )
    if (!chosen) return null
    const pdf = await renderPrintWindow(hash, (contents) => pdfOf(contents, app.getLocale()))
    fs.writeFileSync(chosen, pdf)
    return chosen
  })

  // Print the Timeline across projects (N5.4): every row of the projects shown.
  handleApi('printTimelineOverview', async (_event, request: TimelineOverviewPrintRequest) => {
    if (!request || (request.output !== 'pdf' && request.output !== 'printer'))
      throw new Error('Choose a printer or a PDF')
    let projectIds: string[] | null = null
    if (request.projectIds !== undefined && request.projectIds !== null) {
      if (!Array.isArray(request.projectIds) || request.projectIds.length > 500)
        throw new Error('Choose projects')
      projectIds = request.projectIds.map((id) => {
        if (typeof id !== 'string') throw new Error('Choose projects')
        return getProject(id).id
      })
    }
    const hash = timelineOverviewHashPath(projectIds)
    if (request.output === 'printer') {
      await renderPrintWindow(hash, printContents)
      return null
    }
    const chosen = await saveTo(
      t('errors:importHandlers.savePdf'),
      t('errors:importHandlers.saveButton'),
      `${safeFileName(t('errors:importHandlers.timelineOverviewFile'))}.pdf`,
      [{ name: 'PDF', extensions: ['pdf'] }]
    )
    if (!chosen) return null
    const pdf = await renderPrintWindow(hash, (contents) => pdfOf(contents, app.getLocale()))
    fs.writeFileSync(chosen, pdf)
    return chosen
  })

  // Compare rounds (N5.7b): the series a milestone belongs to, every round and task.
  const roundsRequest = (request: Partial<RoundComparisonPrintRequest> | undefined) => {
    if (!request || !isRoundMeasure(request.measure)) throw new Error('Choose cycle time or time')
    const project = getProject(String(request.projectId))
    const comparison = deps.getReportService().getRoundComparison(project, request.milestoneId)
    return {
      project,
      comparison,
      milestoneId: String(request.milestoneId),
      measure: request.measure
    }
  }

  handleApi('printRoundComparison', async (_event, request: RoundComparisonPrintRequest) => {
    if (!request || (request.output !== 'pdf' && request.output !== 'printer'))
      throw new Error('Choose a printer or a PDF')
    const { project, comparison, milestoneId, measure } = roundsRequest(request)
    const hash = roundsHashPath({ projectId: project.id, milestoneId, measure })
    if (request.output === 'printer') {
      await renderPrintWindow(hash, printContents)
      return null
    }
    const chosen = await saveTo(
      t('errors:importHandlers.savePdf'),
      t('errors:importHandlers.saveButton'),
      `${safeFileName(t('errors:importHandlers.roundsFile', { name: comparison.seriesName }))}.pdf`,
      [{ name: 'PDF', extensions: ['pdf'] }]
    )
    if (!chosen) return null
    const pdf = await renderPrintWindow(hash, (contents) => pdfOf(contents, app.getLocale()))
    fs.writeFileSync(chosen, pdf)
    return chosen
  })

  handleApi(
    'exportRoundComparisonCsv',
    async (_event, request: Omit<RoundComparisonPrintRequest, 'output'>) => {
      const { comparison, measure } = roundsRequest(request)
      const chosen = await saveTo(
        t('errors:importHandlers.exportCsv'),
        t('errors:importHandlers.exportButton'),
        `${safeFileName(t('errors:importHandlers.roundsFile', { name: comparison.seriesName }))}.csv`,
        [{ name: 'CSV (comma separated)', extensions: ['csv'] }]
      )
      if (!chosen) return null
      const filePath = /\.csv$/i.test(chosen) ? chosen : `${chosen}.csv`
      fs.writeFileSync(filePath, roundComparisonCsv(comparison, measure), 'utf8')
      return filePath
    }
  )

  handleApi('importTemplateFile', async () => {
    const choice = await dialog.showOpenDialog(window(), {
      title: t('errors:importHandlers.importTemplate'),
      buttonLabel: 'Import',
      properties: ['openFile'],
      filters: [{ name: t('errors:importHandlers.templateProject'), extensions: ['json'] }]
    })
    const chosen = choice.filePaths[0]
    if (choice.canceled || !chosen) return null
    if (fs.statSync(chosen).size > MAX_IMPORT_FILE_BYTES)
      throw new Error(t('errors:importHandlers.fileLargerThan50'))
    let json: unknown
    try {
      json = JSON.parse(fs.readFileSync(chosen, 'utf8').replace(/^\ufeff/, ''))
    } catch {
      throw new Error(t('errors:importHandlers.fileNotValidJson'))
    }
    return deps.projectPackageService.importTemplate(json)
  })
}
