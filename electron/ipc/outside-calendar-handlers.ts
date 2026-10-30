import { dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type {
  AddCalendarFileInput,
  AddCalendarLinkInput,
  CalendarEventsQuery,
  ChosenCalendarFile,
  UpdateCalendarInput
} from '@shared/ostler-api'
import { IcsReadError, MAX_CALENDAR_BYTES } from '@shared/import/ics-read'
import type { OutsideCalendarService } from '../services/outside-calendar-service'
import type { ApiArgs, ApiInvokeMethod, ApiValue } from '@shared/ostler-api/api-channels'
import { handleApi } from './handle-ipc'
import { t } from '@shared/i18n'

/**
 * Reads a calendar file the person chose: a regular `.ics` file no bigger
 * than the reader takes. Never copied into the data folder; read only when a
 * calendar is added or reloaded.
 */
export function readCalendarFile(file: string): string {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.ics$/i.test(file))
    throw new Error(t('errors:outsideCalendars.needsFile'))
  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    throw new Error(t('errors:outsideCalendars.fileGone'))
  }
  if (!stat.isFile()) throw new Error(t('errors:outsideCalendars.fileGone'))
  if (stat.size > MAX_CALENDAR_BYTES) throw new IcsReadError(t('errors:icsRead.calendarTooBig'))
  return fs.readFileSync(file, 'utf8')
}

export interface OutsideCalendarHandlerDependencies {
  outsideCalendarService: OutsideCalendarService
  getMainWindow(): BrowserWindow | null
  /** Pushes ON_PROJECT_STATE_CHANGE with field 'calendars'. */
  notifyCalendarsChanged(): void
}

/**
 * Outside calendars (N3.3a). Global, so no project is resolved; the service
 * validates every id, name, colour and range. Main shows the file dialog,
 * and a calendar is added only from a path chosen in it this session, so the
 * renderer cannot name a file of its own.
 */
export function registerOutsideCalendarHandlers({
  outsideCalendarService,
  getMainWindow,
  notifyCalendarsChanged
}: OutsideCalendarHandlerDependencies): void {
  const chosen = new Set<string>()
  const mutating = <M extends ApiInvokeMethod>(
    method: M,
    handler: (...args: ApiArgs<M>) => ApiValue<M> | Promise<ApiValue<M>>
  ) =>
    handleApi(method, async (_event, ...args) => {
      const result = await handler(...args)
      notifyCalendarsChanged()
      return result
    })

  handleApi('getOutsideCalendars', async () => outsideCalendarService.list())
  handleApi('getCalendarEvents', async (_event, query: CalendarEventsQuery) =>
    outsideCalendarService.events(query)
  )
  mutating('addCalendarFile', (input: AddCalendarFileInput) => {
    if (typeof input?.path !== 'string' || !chosen.has(input.path))
      throw new Error(t('errors:outsideCalendars.notChosen'))
    return outsideCalendarService.addFile(input)
  })
  mutating('reloadOutsideCalendar', (calendarId: string) =>
    outsideCalendarService.reload(calendarId)
  )
  mutating('updateOutsideCalendar', (calendarId: string, updates: UpdateCalendarInput) =>
    outsideCalendarService.update(calendarId, updates)
  )
  mutating('removeOutsideCalendar', (calendarId: string) =>
    outsideCalendarService.remove(calendarId)
  )
  mutating('restoreOutsideCalendar', (calendarId: string) =>
    outsideCalendarService.restore(calendarId)
  )
  // Calendar links (N3.3b): main fetches; the renderer never does, and never gets the link back.
  mutating('addCalendarLink', (input: AddCalendarLinkInput) =>
    outsideCalendarService.addLink(input)
  )
  mutating('refreshCalendarLink', (calendarId: string) =>
    outsideCalendarService.refresh(calendarId)
  )
  mutating('replaceCalendarLink', (calendarId: string, link: string) =>
    outsideCalendarService.replaceLink(calendarId, link)
  )

  handleApi('chooseCalendarFile', async (): Promise<ChosenCalendarFile | null> => {
    const window = getMainWindow()
    const options = {
      title: t('errors:outsideCalendars.chooseFile'),
      properties: ['openFile' as const],
      filters: [{ name: t('errors:outsideCalendars.calendarFile'), extensions: ['ics'] }]
    }
    const choice = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const file = choice.filePaths[0]
    if (choice.canceled || !file) return null
    const preview = outsideCalendarService.preview(readCalendarFile(file), path.basename(file))
    chosen.add(file)
    return { ...preview, path: file }
  })
}
