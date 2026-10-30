import { expect, test } from '@playwright/test'
import * as fs from 'fs'
import * as net from 'node:net'
import * as path from 'path'
import { closeAudit, launchForAudit, openPath, type A11yApp } from './a11y-app'

/**
 * Settings › Connections › Email (MOP-4) in the real app: the server is
 * saved through main, its password encrypted on disk and never shown again,
 * and a test email to a server that is not there says so in plain words.
 */

let target: A11yApp | null = null

test.afterEach(async () => {
  if (target) await closeAudit(target)
  target = null
})

/** A port on this PC with nothing listening on it. */
function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      probe.close(() =>
        address && typeof address !== 'string' ? resolve(address.port) : reject(new Error('port'))
      )
    })
  })
}

test('sets up the email server, keeps its password secret, and says why a test cannot send', async () => {
  test.setTimeout(120_000)
  target = await launchForAudit({ theme: 'light' })
  const { page, dataDir } = target
  await page.locator('main').first().waitFor()
  await openPath(page, '/settings/connections')

  await page.getByRole('button', { name: 'Set up email…' }).click()
  await page.getByRole('textbox', { name: /^Server/ }).fill('127.0.0.1')
  await page.getByRole('combobox', { name: 'Connection' }).selectOption('tls')
  const port = page.getByRole('spinbutton', { name: 'Port' })
  await port.fill(String(await closedPort()))
  await port.blur()
  await page.getByRole('textbox', { name: /^User name/ }).fill('sam@example.com')
  await page.getByLabel(/^Password/).fill('e2e-app-password')
  await page.getByRole('textbox', { name: 'From address' }).fill('sam@example.com')
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(page.getByText('Sends as sam@example.com through 127.0.0.1.')).toBeVisible()
  const onDisk = fs.readFileSync(path.join(dataDir, 'config.json'), 'utf-8')
  expect(onDisk).toContain('"fromAddress": "sam@example.com"')
  expect(onDisk).not.toContain('e2e-app-password')

  await page.getByRole('button', { name: 'Send a test email' }).click()
  await expect(page.getByText(/Couldn't reach the email server/)).toBeVisible({
    timeout: 30_000
  })

  // Change… keeps the saved password unless a new one is typed.
  await page.getByRole('button', { name: 'Change…' }).click()
  await expect(page.getByText('A password is saved. Leave this empty to keep it.')).toBeVisible()
})
