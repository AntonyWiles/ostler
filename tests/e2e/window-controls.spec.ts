import { expect, test } from '@playwright/test'
import * as path from 'path'
import { closeAudit, launchForAudit, type A11yApp } from './a11y-app'

/**
 * The custom title bar draws its own Minimise, Maximise and Close in place of
 * Windows' (no `titleBarOverlay`), and Close goes through the window's own
 * close: with background mode on, the main window hides and Ostler keeps
 * running.
 */

let target: A11yApp

test.afterEach(async () => {
  if (target) await closeAudit(target)
})

const shots = process.env.OSTLER_WINDOW_CONTROL_SHOTS

test('draws its own window buttons, and Close hides to the tray in background mode', async () => {
  target = await launchForAudit({ theme: 'light', desktop: { backgroundMode: true } })
  const { app, page } = target

  const titleBar = page.locator('header.ostler-titlebar')
  const minimise = titleBar.getByRole('button', { name: 'Minimise', exact: true })
  const maximise = titleBar.getByRole('button', { name: 'Maximise', exact: true })
  const close = titleBar.getByRole('button', { name: 'Close', exact: true })
  await expect(minimise).toBeVisible()
  await expect(maximise).toBeVisible()
  await expect(close).toBeVisible()

  // Windows no longer draws its own buttons over the strip.
  const overlay = await page.evaluate(
    () =>
      (navigator as unknown as { windowControlsOverlay?: { visible: boolean } })
        .windowControlsOverlay?.visible ?? false
  )
  expect(overlay).toBe(false)

  // Flush with the window's right edge.
  const box = await close.boundingBox()
  const width = await page.evaluate(() => document.documentElement.clientWidth)
  expect(box && Math.round(box.x + box.width)).toBe(width)

  if (shots) await titleBar.screenshot({ path: path.join(shots, 'title-bar.png') })
  await close.hover()
  await expect(close).toHaveCSS('background-color', 'rgb(220, 38, 38)')
  if (shots) await titleBar.screenshot({ path: path.join(shots, 'title-bar-close-hover.png') })

  await close.click()
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()))
    .toBe(false)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
})
