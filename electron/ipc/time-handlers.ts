import { dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import type {
  CreateTimeEntryInput,
  TimeEntry,
  TimeEntryQuery,
  UpdateTimeEntryInput,
  WatchedProject
} from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import { buildTimeEntriesCsv } from '../services/export-service'
import type { PlanningService } from '../services/planning-service'
import { safeFileName } from '../app/file-names'
import { handleApi } from './handle-ipc'

export interface TimeHandlerDependencies {
  planningService: PlanningService
  getProject(projectId: string): WatchedProject
  getProjects(): WatchedProject[]
  getMainWindow(): BrowserWindow | null
}

/**
 * Time tracking (R2.3): entries and the timer. Every write goes through
 * `planningService.time`, whose change listener tells the window, the tray
 * and the jump list, so these handlers do not notify on their own.
 */
export function registerTimeHandlers(deps: TimeHandlerDependencies): void {
  const { planningService, getProject } = deps
  const time = planningService.time
  const knownIds = () => deps.getProjects().map((project) => project.id)

  handleApi('getTaskTimeEntries', (_event, projectId: string, workItemId: string) => {
    getProject(projectId)
    const entries = time.listForWorkItem(workItemId)
    if (entries.some((entry) => entry.projectId !== projectId))
      throw new Refusal(t('errors:timeTracking.taskNotInProject'))
    return entries
  })
  handleApi('getTimeTotals', (_event, projectId: string) => time.totals(getProject(projectId).id))
  handleApi('listTimeEntries', (_event, query: TimeEntryQuery) => time.list(query, knownIds()))
  handleApi('createTimeEntry', (_event, projectId: string, input: CreateTimeEntryInput) =>
    time.create(getProject(projectId).id, input)
  )
  handleApi(
    'updateTimeEntry',
    (_event, projectId: string, entryId: string, input: UpdateTimeEntryInput) =>
      time.update(getProject(projectId).id, entryId, input)
  )
  handleApi('deleteTimeEntry', (_event, projectId: string, entryId: string) =>
    time.delete(getProject(projectId).id, entryId)
  )
  handleApi('restoreTimeEntry', (_event, projectId: string, entry: TimeEntry) =>
    time.restore(getProject(projectId).id, entry)
  )
  handleApi('exportTimeCsv', async (_event, query: TimeEntryQuery) => {
    const { text } = buildTimeEntriesCsv(planningService, deps.getProjects(), query)
    const window = deps.getMainWindow()
    const options = {
      title: t('errors:timeTracking.exportTitle'),
      defaultPath: `${safeFileName(t('errors:timeTracking.exportFileName'))}.csv`,
      filters: [{ name: 'CSV (comma separated)', extensions: ['csv'] }]
    }
    const choice = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (choice.canceled || !choice.filePath) return null
    const filePath = /\.csv$/i.test(choice.filePath) ? choice.filePath : `${choice.filePath}.csv`
    fs.writeFileSync(filePath, text, 'utf8')
    return filePath
  })

  handleApi('getTimer', () => time.timerState())
  handleApi('startTimer', (_event, projectId: string, workItemId: string) =>
    time.startTimer(getProject(projectId).id, workItemId)
  )
  handleApi('stopTimer', () => time.stopTimer())
  handleApi('undoTimerStart', (_event, startedId: string, stoppedId: string | null) =>
    time.undoStart(startedId, stoppedId)
  )
  handleApi('resolveInterruptedTimer', (_event, choice: unknown) => {
    if (choice !== 'keep' && choice !== 'stop') throw new Refusal('Choose keep or stop')
    return time.resolveInterrupted(choice)
  })
}
