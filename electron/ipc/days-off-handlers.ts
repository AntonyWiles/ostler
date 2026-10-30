import { dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type {
  CreateDayOffInput,
  DayOff,
  DaysOffFile,
  DaysOffImportInput,
  DaysOffQuery,
  SharedAwayQuery,
  UpdateDayOffInput
} from '@shared/ostler-api'
import type { ApiArgs, ApiInvokeMethod, ApiValue } from '@shared/ostler-api/api-channels'
import { MAX_ICS_BYTES } from '@shared/import/ics-read'
import type { DaysOffService } from '../services/days-off-service'
import type { AwaySharingService } from '../services/away-sharing-service'
import { handleApi } from './handle-ipc'
import { t } from '@shared/i18n'

export interface DaysOffHandlerDependencies {
  daysOffService: DaysOffService
  awaySharingService: AwaySharingService
  getMainWindow(): BrowserWindow | null
  /** Pushes ON_PROJECT_STATE_CHANGE with field 'daysOff'. */
  notifyDaysOffChanged(): void
}

/**
 * Days off (N3.2). Global, so no project is resolved; the service validates
 * every id, date and person, the same as for the automation API. Main shows
 * the file dialog and checks the file's size before reading it.
 */
export function registerDaysOffHandlers({
  daysOffService,
  awaySharingService,
  getMainWindow,
  notifyDaysOffChanged
}: DaysOffHandlerDependencies): void {
  const mutating = <M extends ApiInvokeMethod>(
    method: M,
    handler: (...args: ApiArgs<M>) => ApiValue<M> | Promise<ApiValue<M>>
  ) =>
    handleApi(method, async (_event, ...args) => {
      const result = handler(...args)
      notifyDaysOffChanged()
      return result
    })

  handleApi('getSharedAway', async (_event, query: SharedAwayQuery) =>
    awaySharingService.listOthers(query)
  )
  handleApi('getAwaySharing', async (_event, projectId: string) =>
    awaySharingService.isShared(projectId)
  )
  handleApi('setAwaySharing', async (_event, projectId: string, shared: boolean) => {
    awaySharingService.setShared(projectId, shared === true)
    return awaySharingService.isShared(projectId)
  })

  handleApi('getDaysOff', async (_event, query?: DaysOffQuery) => daysOffService.list(query ?? {}))
  mutating('createDayOff', (input: CreateDayOffInput) => daysOffService.create(input))
  mutating('updateDayOff', (dayOffId: string, updates: UpdateDayOffInput) =>
    daysOffService.update(dayOffId, updates)
  )
  mutating('removeDayOff', (dayOffId: string) => daysOffService.remove(dayOffId))
  mutating('restoreDaysOff', (days: DayOff[]) => daysOffService.restore(days))
  mutating('importDaysOff', (input: DaysOffImportInput) => daysOffService.importFile(input))
  mutating('removeDaysOffFile', (fileName: string, personId?: string | null) =>
    daysOffService.removeFile(fileName, personId)
  )
  handleApi('previewDaysOffImport', async (_event, input: DaysOffImportInput) =>
    daysOffService.importFile(input, { dryRun: true })
  )

  handleApi('chooseDaysOffFile', async (): Promise<DaysOffFile | null> => {
    const window = getMainWindow()
    const options = {
      title: t('errors:daysOffHandlers.chooseFile'),
      properties: ['openFile' as const],
      filters: [{ name: t('errors:daysOffHandlers.calendarFile'), extensions: ['ics'] }]
    }
    const choice = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const chosen = choice.filePaths[0]
    if (choice.canceled || !chosen) return null
    if (fs.statSync(chosen).size > MAX_ICS_BYTES) throw new Error(t('errors:icsRead.tooBig'))
    return { fileName: path.basename(chosen), text: fs.readFileSync(chosen, 'utf8') }
  })
}
