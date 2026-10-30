import { app, dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import type { WatchedProject } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { timeReportHashPath } from '@shared/print-route'
import { buildTimeReportCsv } from '../services/export-service'
import type { PlanningService } from '../services/planning-service'
import { pdfOf, printContents, renderPrintWindow } from '../app/print-window'
import { safeFileName } from '../app/file-names'
import { handleApi } from './handle-ipc'

/**
 * Billable time (N6.4): the rate and default, the Time report with its CSV
 * and print, and billings. Every read and write goes through
 * `planningService.billing`, the service the automation API uses; the
 * project must be one Ostler knows.
 */
export function registerBillingHandlers({
  planningService,
  getProject,
  getMainWindow
}: {
  planningService: PlanningService
  getProject(projectId: string): WatchedProject
  getMainWindow(): BrowserWindow | null
}): void {
  const billing = planningService.billing
  const id = (projectId: string) => getProject(projectId).id

  const saveTo = async (title: string, defaultName: string, filters: Electron.FileFilter[]) => {
    const window = getMainWindow()
    const options = { title, defaultPath: defaultName, filters }
    const choice = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    return choice.canceled || !choice.filePath ? null : choice.filePath
  }

  handleApi('getBillingSettings', (_event, projectId: string) => billing.getSettings(id(projectId)))
  handleApi('setBillingSettings', (_event, projectId: string, input: unknown) =>
    billing.setSettings(id(projectId), input)
  )
  handleApi('getTimeReport', (_event, projectId: string, from: string, to: string) =>
    billing.report(id(projectId), from, to)
  )
  handleApi('markBilled', (_event, projectId: string, range: unknown) =>
    billing.markBilled(id(projectId), range)
  )
  handleApi('unmarkBilling', (_event, projectId: string, billingId: string) =>
    billing.unmark(id(projectId), billingId)
  )
  handleApi('restoreBilling', (_event, projectId: string, unmarked: unknown) =>
    billing.restore(id(projectId), unmarked)
  )
  handleApi('exportTimeReportCsv', async (_event, projectId: string, from: string, to: string) => {
    const project = getProject(projectId)
    const { text } = buildTimeReportCsv(planningService, project.id, from, to)
    const chosen = await saveTo(
      t('errors:billing.exportTitle'),
      `${safeFileName(t('errors:billing.exportFileName', { project: project.name, from, to }))}.csv`,
      [{ name: 'CSV (comma separated)', extensions: ['csv'] }]
    )
    if (!chosen) return null
    const filePath = /\.csv$/i.test(chosen) ? chosen : `${chosen}.csv`
    fs.writeFileSync(filePath, text, 'utf8')
    return filePath
  })
  handleApi(
    'printTimeReport',
    async (
      _event,
      request: { projectId: string; from: string; to: string; output: 'printer' | 'pdf' }
    ) => {
      if (!request || (request.output !== 'pdf' && request.output !== 'printer'))
        throw new Error('Choose a printer or a PDF')
      const project = getProject(String(request.projectId))
      // Checks the range the same way the view's report does.
      billing.report(project.id, request.from, request.to)
      const hash = timeReportHashPath({ projectId: project.id, from: request.from, to: request.to })
      if (request.output === 'printer') {
        await renderPrintWindow(hash, printContents)
        return null
      }
      const chosen = await saveTo(
        t('errors:importHandlers.savePdf'),
        `${safeFileName(
          t('errors:billing.printFileName', {
            project: project.name,
            from: request.from,
            to: request.to
          })
        )}.pdf`,
        [{ name: 'PDF', extensions: ['pdf'] }]
      )
      if (!chosen) return null
      const pdf = await renderPrintWindow(hash, (contents) => pdfOf(contents, app.getLocale()))
      fs.writeFileSync(chosen, pdf)
      return chosen
    }
  )
}
