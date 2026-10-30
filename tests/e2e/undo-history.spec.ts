import { expect, test } from '@playwright/test'
import * as path from 'path'
import type { OstlerAPI } from '../../src/shared/ostler-api'
import { closeAudit, createSampleProject, launchForAudit, openPath, type A11yApp } from './a11y-app'

/**
 * The undo history end to end: changes made through the window are listed in
 * words, one old step is undone without undoing the later one, and the title
 * bar's Undo and Redo act on the newest step.
 */

let target: A11yApp

test.afterEach(async () => {
  if (target) await closeAudit(target)
})

const shots = process.env.OSTLER_UNDO_SHOTS

test('undoes one old step, keeps later ones, and redoes from the title bar', async () => {
  target = await launchForAudit({ theme: 'light' })
  const { page } = target
  const { projectId, taskId } = await createSampleProject(page)

  await page.evaluate(
    async ({ taskId }) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const rename = await api.updatePlanningWorkItem(taskId, { title: 'Paint the hall' })
      if (!rename.ok) throw new Error(rename.error)
      const priority = await api.updatePlanningWorkItem(taskId, { priority: 'high' })
      if (!priority.ok) throw new Error(priority.error)
    },
    { taskId }
  )

  await openPath(page, '/undo-history')
  await expect(page.getByRole('heading', { name: 'Undo history', level: 1 })).toBeVisible()
  const rename = page
    .locator('.undo-history__entry')
    .filter({
      has: page.locator('.undo-history__title', { hasText: /^Changed task “Paint the hall”/ })
    })
    .filter({ has: page.locator('.undo-history__meta', { hasText: 'Title' }) })
  await expect(rename).toContainText('Changed task “Paint the hall”')
  if (shots) await page.screenshot({ path: path.join(shots, 'undo-history.png') })

  // Undo the rename only: the later priority change stays.
  await rename.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.locator('.ui-toast__title', { hasText: /^Undone: Changed task/ })).toBeVisible()
  const after = await page.evaluate(
    async ({ projectId, taskId }) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const items = await api.getPlanningWorkItems(projectId)
      if (!items.ok) throw new Error(items.error)
      return items.value.find((item) => item.id === taskId)
    },
    { projectId, taskId }
  )
  expect(after?.title).not.toBe('Paint the hall')
  expect(after?.priority).toBe('high')
  await expect(rename).toHaveClass(/is-undone/)
  if (shots) await page.screenshot({ path: path.join(shots, 'undo-history-undone.png') })

  // The title bar's Redo puts the rename back.
  await page
    .locator('.ostler-titlebar-undo')
    .getByRole('button', { name: /^Redo:/ })
    .click()
  await expect(page.locator('.ui-toast__title', { hasText: /^Redone: Changed task/ })).toBeVisible()
  // The rename is in force again; the undo it had is the step now undone.
  await expect(rename).not.toHaveClass(/is-undone/)
  await expect(
    page.locator('.undo-history__entry.is-undone', { hasText: 'Undid: Changed task' })
  ).toHaveCount(1)
  if (shots) await page.screenshot({ path: path.join(shots, 'undo-history-redone.png') })
})
