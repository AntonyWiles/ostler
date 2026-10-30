import { expect, test, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { closeAudit, createSampleProject, launchForAudit, openPath, type A11yApp } from './a11y-app'

/**
 * The walkthrough and every one-off tip, end to end in the sample project: the
 * invitation and each step of the tour from first to Done; then, for someone
 * who said no to the tour (finishing it puts away the tips it covered), each
 * view's tip and the task drawer's two, each closed with "Don't show this tip
 * again" so the next can show. With OSTLER_TIPS_SHOTS set to a folder, a screenshot of
 * each, per theme, lands there: the way to look the whole set over. The locale
 * is pinned, so the demo's money and dates look the same on every machine.
 */

let target: A11yApp

test.afterEach(async () => {
  if (target) await closeAudit(target)
})

const shots = process.env.OSTLER_TIPS_SHOTS
if (shots) fs.mkdirSync(shots, { recursive: true })

const LOCALE = 'en-GB'

/** The tour's steps, as the invitation counts them. */
const TOUR_STEPS = 14

/** Long enough for a tip to wait its turn, place itself and settle. */
const SETTLE_MS = 900

async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) })
}

for (const theme of ['dark', 'light'] as const) {
  test(`the walkthrough runs from invitation to Done in the sample project (${theme})`, async () => {
    test.setTimeout(180_000)
    target = await launchForAudit({ theme, locale: LOCALE })
    const { page } = target
    const { projectId } = await createSampleProject(page)
    const tip = page.getByTestId('coachmark')

    await openPath(page, `/projects/${projectId}/board`)
    await expect(tip).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(SETTLE_MS)
    await shot(page, `${theme}-tour-00-invite`)
    await tip.getByRole('button', { name: 'Show me around' }).click()

    for (let step = 1; step <= TOUR_STEPS; step++) {
      await expect(tip).toContainText(`${step} of ${TOUR_STEPS}`, { timeout: 15_000 })
      await page.waitForTimeout(SETTLE_MS)
      await shot(page, `${theme}-tour-${String(step).padStart(2, '0')}`)
      await tip.getByRole('button', { name: step === TOUR_STEPS ? 'Done' : 'Next' }).click()
    }
    await expect(tip).toHaveCount(0)
  })

  test(`every one-off tip shows once the tour is declined (${theme})`, async () => {
    test.setTimeout(180_000)
    target = await launchForAudit({
      theme,
      locale: LOCALE,
      ui: { tips: { enabled: true, dismissed: ['tour:sample'] } }
    })
    const { page } = target
    const { projectId, taskId } = await createSampleProject(page)
    const tip = page.getByTestId('coachmark')

    // Each view's own tip.
    for (const view of ['board', 'list', 'calendar', 'timeline', 'library']) {
      await openPath(page, `/projects/${projectId}/${view}`)
      await expect(tip, view).toBeVisible({ timeout: 15_000 })
      await page.waitForTimeout(SETTLE_MS)
      await shot(page, `${theme}-tip-${view}`)
      await tip.getByRole('button', { name: "Don't show this tip again" }).click()
      await expect(tip).toHaveCount(0)
    }

    // The task drawer has two: changes save as you go, then resizing it. Opened afresh
    // for each, as each view is, so the pause after a tip closes doesn't hold up the next.
    for (const name of ['drawer-saves', 'drawer-resize']) {
      await openPath(page, `/projects/${projectId}/tasks/${taskId}`)
      await expect(tip, name).toBeVisible({ timeout: 15_000 })
      await page.waitForTimeout(SETTLE_MS)
      await shot(page, `${theme}-tip-${name}`)
      await tip.getByRole('button', { name: "Don't show this tip again" }).click()
    }
    await expect(tip).toHaveCount(0)
  })
}
