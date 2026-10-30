import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Opens a project view by name: its tab, or More views beside the tabs for a
 * view the project doesn't use (yet), where ticking it gives it a tab and
 * opens it (a tab that doesn't fit the row is a plain item there). A view
 * earns its tab once the project's usage loads, which can be a moment after
 * the project opens, so this tries again until one or the other is there.
 * That can also happen while More views is open, moving its items under the
 * pointer, so it checks the view it asked for is the one that opened.
 */
export async function openProjectView(page: Page, name: string): Promise<void> {
  const tab = page.getByRole('tab', { name, exact: true })
  await expect(async () => {
    if ((await tab.count()) > 0) await tab.click({ timeout: 2000 })
    else {
      await page.getByRole('button', { name: 'More views' }).click({ timeout: 2000 })
      try {
        const plain = page.getByRole('menuitem', { name, exact: true })
        const unticked = page.getByRole('menuitemcheckbox', { name, exact: true, checked: false })
        await plain.or(unticked).first().click({ timeout: 2000 })
      } catch (error) {
        await page.keyboard.press('Escape')
        throw error
      }
    }
    await expect(page.getByRole('tab', { name, exact: true, selected: true })).toBeVisible({
      timeout: 2000
    })
  }).toPass({ timeout: 20_000 })
}

/**
 * Adds a part to the open task from "Add to this task": its own button when
 * the bar shows one, else from the bar's "more" menu. The part opens, ready.
 */
export async function addTaskPart(page: Page, drawer: Locator, name: string): Promise<void> {
  const bar = drawer.getByRole('group', { name: 'Add to this task' })
  const chip = bar.getByRole('button', { name, exact: true })
  if ((await chip.count()) > 0) return chip.click()
  await bar.getByRole('button', { name: /more$/ }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}
