import { dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import type { WatchedProject } from '@shared/ostler-api'
import type { CostQuery } from '@shared/money'
import { t } from '@shared/i18n'
import { buildCostsCsv } from '../services/export-service'
import type { PlanningService } from '../services/planning-service'
import { safeFileName } from '../app/file-names'
import { handleApi } from './handle-ipc'

/**
 * Budgets and costs (N6.3a), the shopping list (N6.3b) and baselines (N7.4): the desktop app reads and writes through the one
 * service the automation API uses (`planningService.costs`), which checks
 * every id; the project must be one Ostler knows.
 */
export function registerCostHandlers({
  planningService,
  getProject,
  getMainWindow
}: {
  planningService: PlanningService
  getProject(projectId: string): WatchedProject
  getMainWindow(): BrowserWindow | null
}): void {
  const costs = planningService.costs
  const id = (projectId: string) => getProject(projectId).id

  handleApi('getBudget', (_event, projectId: string) => costs.getBudget(id(projectId)))
  handleApi('setBudget', (_event, projectId: string, input: unknown) =>
    costs.setBudget(id(projectId), input)
  )
  handleApi('getMoneySummary', (_event, projectId: string) => costs.summary(id(projectId)))
  handleApi('listCosts', (_event, projectId: string, query?: CostQuery) =>
    costs.list(id(projectId), query ?? {})
  )
  handleApi('listCostCategories', (_event, projectId: string) => costs.categories(id(projectId)))
  handleApi('createCost', (_event, projectId: string, input: unknown) =>
    costs.create(id(projectId), input)
  )
  handleApi('updateCost', (_event, projectId: string, costId: string, input: unknown) =>
    costs.update(id(projectId), costId, input)
  )
  handleApi('markCostPaid', (_event, projectId: string, costId: string, input: unknown) =>
    costs.markPaid(id(projectId), costId, input)
  )
  handleApi('deleteCost', (_event, projectId: string, costId: string) =>
    costs.delete(id(projectId), costId)
  )
  handleApi('restoreCost', (_event, projectId: string, cost: unknown) =>
    costs.restore(id(projectId), cost)
  )
  // The shopping list (N6.3b), through the same planning connection as costs.
  const shopping = planningService.shopping
  handleApi('listShopping', (_event, projectId: string) => shopping.list(id(projectId)))
  handleApi('createShoppingItem', (_event, projectId: string, input: unknown) =>
    shopping.create(id(projectId), input)
  )
  handleApi('updateShoppingItem', (_event, projectId: string, itemId: string, input: unknown) =>
    shopping.update(id(projectId), itemId, input)
  )
  handleApi('deleteShoppingItem', (_event, projectId: string, itemId: string) =>
    shopping.delete(id(projectId), itemId)
  )
  handleApi('restoreShoppingItem', (_event, projectId: string, item: unknown) =>
    shopping.restore(id(projectId), item)
  )
  handleApi('buyShoppingItem', (_event, projectId: string, itemId: string, input: unknown) =>
    shopping.buy(id(projectId), itemId, input)
  )
  handleApi('unbuyShoppingItem', (_event, projectId: string, itemId: string) =>
    shopping.unbuy(id(projectId), itemId)
  )
  handleApi('rebuyShoppingItem', (_event, projectId: string, itemId: string, cost: unknown) =>
    shopping.rebuy(id(projectId), itemId, cost)
  )
  handleApi('exportCostsCsv', async (_event, projectId: string, query?: CostQuery) => {
    const project = getProject(projectId)
    const { text } = buildCostsCsv(planningService, project.id, query ?? {})
    const window = getMainWindow()
    const options = {
      title: t('errors:costs.exportTitle'),
      defaultPath: `${safeFileName(t('errors:costs.exportFileName', { project: project.name }))}.csv`,
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

  // Baselines (N7.4), through the service the automation API uses.
  const baselines = planningService.baselines
  handleApi('listBaselines', (_event, projectId: string) => baselines.list(id(projectId)))
  handleApi('getBaseline', (_event, projectId: string, baselineId: string) =>
    baselines.get(id(projectId), baselineId)
  )
  handleApi('createBaseline', (_event, projectId: string, input: unknown) =>
    baselines.create(id(projectId), input)
  )
  handleApi('renameBaseline', (_event, projectId: string, baselineId: string, name: unknown) =>
    baselines.rename(id(projectId), baselineId, { name })
  )
  handleApi('deleteBaseline', (_event, projectId: string, baselineId: string) =>
    baselines.delete(id(projectId), baselineId)
  )
  handleApi('restoreBaseline', (_event, projectId: string, baseline: unknown) =>
    baselines.restore(id(projectId), baseline)
  )
  handleApi('compareBaseline', (_event, projectId: string, baselineId: string) =>
    baselines.compare(id(projectId), baselineId)
  )
}
