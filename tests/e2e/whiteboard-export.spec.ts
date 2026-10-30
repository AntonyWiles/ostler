import { expect, test } from '@playwright/test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { OstlerAPI } from '../../src/shared/ostler-api'
import { closeAudit, createSampleProject, launchForAudit, openPath, type A11yApp } from './a11y-app'

/**
 * Export and import of whiteboards (plan `docs/plans/whiteboards/`, prompt 16, D15) in the real
 * app, off screen: Export › PNG picture, SVG drawing and Whiteboard file each write a file where
 * the person chose (main's save dialog is replaced), and Import a whiteboard file… in New
 * whiteboard turns the exported file into a second board with the same objects. Save as PDF…
 * (prompt 17) writes a PDF from main's print window.
 */

let target: A11yApp | null = null
let outDir: string | null = null

test.afterEach(async () => {
  if (target) await closeAudit(target)
  target = null
  if (outDir) fs.rmSync(outDir, { recursive: true, force: true })
  outDir = null
})

// A real 1x1 PNG.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

test('exports a whiteboard as PNG, SVG and a whiteboard file, and imports the file', async () => {
  test.setTimeout(180_000)
  target = await launchForAudit({ theme: 'light' })
  const { app, page } = target
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-whiteboard-export-'))
  outDir = dir
  await page.locator('main').first().waitFor()
  const { projectId } = await createSampleProject(page)

  // A board with a note and a picture imported into the Library.
  const whiteboardId = await page.evaluate(
    async ({ projectId, base64 }) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const imported = await api.importLibraryFiles(projectId, [
        { fileName: 'Dot.png', mimeType: 'image/png', bytes }
      ])
      if (!imported.ok) throw new Error(imported.error)
      const created = await api.createWhiteboard(projectId, {
        title: 'Launch plan',
        objects: [
          {
            id: crypto.randomUUID(),
            kind: 'note',
            x: 0,
            y: 0,
            width: 200,
            height: 200,
            z: 0,
            text: 'Ship it'
          },
          {
            id: crypto.randomUUID(),
            kind: 'image',
            x: 260,
            y: 0,
            width: 120,
            height: 120,
            z: 1,
            data: { imageItemId: imported.value[0].item.id }
          }
        ] as never
      })
      if (!created.ok) throw new Error(created.error)
      return created.value.item.id
    },
    { projectId, base64: PNG_BASE64 }
  )

  // Every save goes into the temporary folder, under the name main proposes.
  await app.evaluate(({ dialog }, folder) => {
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      const options = args[args.length - 1] as { defaultPath?: string }
      const name = (options.defaultPath ?? 'export').split(/[\\/]/).pop()
      return { canceled: false, filePath: `${folder}\\${name}` }
    }) as unknown as typeof dialog.showSaveDialog
  }, dir)

  await openPath(page, `/projects/${projectId}/plan?whiteboard=${whiteboardId}`)
  await expect(page.getByRole('heading', { name: 'Launch plan' })).toBeVisible()

  const exportAs = async (item: string, fileName: string) => {
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await page.getByRole('menuitem', { name: item }).click()
    await expect(page.getByText(`Saved ${fileName}`).first()).toBeVisible({ timeout: 30_000 })
    return path.join(dir, fileName)
  }

  const png = await exportAs('PNG picture', 'Launch plan.png')
  expect([...fs.readFileSync(png).subarray(0, 8)]).toEqual(PNG_SIGNATURE)

  const svg = await exportAs('SVG drawing', 'Launch plan.svg')
  const svgText = fs.readFileSync(svg, 'utf8')
  expect(svgText).toContain('data:image/png;base64')
  expect(svgText).not.toContain('class=')
  // Colours are written out, not left to the app's CSS variables.
  expect(svgText).not.toContain('var(')
  expect(svgText).toMatch(/fill="rgb\(/)
  // The PNG is drawn at twice the drawing's size.
  const svgWidth = Number(/<svg[^>]*\swidth="([\d.]+)"/.exec(svgText)?.[1])
  expect(fs.readFileSync(png).readUInt32BE(16)).toBe(Math.floor(svgWidth * 2))

  const file = await exportAs('Whiteboard file', 'Launch plan.whiteboard.json')
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).pictures).toHaveLength(1)

  // Save as PDF… (prompt 17) draws the board in main's print window and writes a PDF.
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Save as PDF…' }).click()
  await expect(page.getByText('Saved the PDF Launch plan.pdf').first()).toBeVisible({
    timeout: 60_000
  })
  const pdf = fs.readFileSync(path.join(dir, 'Launch plan.pdf'))
  expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF')
  // The picture is in it: the print page waited for it before it was drawn.
  expect(pdf.toString('latin1')).toMatch(/\/Subtype\s*\/Image/)

  // Import a whiteboard file… makes a second board from it and opens it.
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [filePath]
    })) as unknown as typeof dialog.showOpenDialog
  }, file)
  await page.getByRole('button', { name: 'Back to the plan' }).click()
  await page.getByRole('button', { name: 'New whiteboard' }).click()
  const dialog = page.getByRole('dialog', { name: 'New whiteboard' })
  await dialog.getByRole('button', { name: 'Import a whiteboard file…' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Launch plan' })).toBeVisible()

  const boards = await page.evaluate(async (projectId) => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const items = await api.listLibraryItems(projectId, { kind: 'whiteboard' })
    if (!items.ok) throw new Error(items.error)
    return Promise.all(
      items.value.map(async (item) => {
        const board = await api.getWhiteboard(projectId, item.id)
        if (!board.ok) throw new Error(board.error)
        return { id: item.id, objects: board.value.objects.length }
      })
    )
  }, projectId)
  expect(boards).toHaveLength(2)
  const copy = boards.find((board) => board.id !== whiteboardId)
  expect(copy?.objects).toBe(2)
})
