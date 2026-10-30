import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every copy goes through `copyText` in `electron/app/clipboard.ts`, the one
 * place that knows Ostler keeps its own clipboard off screen. Nothing else in
 * main writes Electron's clipboard, and the renderer never touches
 * `navigator.clipboard`: it copies through the COPY_TEXT call.
 */

const root = path.resolve(__dirname, '../..')
const ONE_WAY = path.join('electron', 'app', 'clipboard.ts')

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(relative)
    return /\.(ts|tsx)$/.test(entry.name) ? [relative] : []
  })
}

describe('clipboard writes', () => {
  it('go only through copyText', () => {
    const offenders = [...sourceFiles('electron'), ...sourceFiles('src')]
      .filter((file) => file !== ONE_WAY)
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), 'utf8')
        return (
          /\bclipboard\s*\.\s*write/.test(text) ||
          /navigator\s*\.\s*clipboard/.test(text) ||
          /import\s*\{[^}]*\bclipboard\b[^}]*\}\s*from\s*'electron'/.test(text)
        )
      })
    expect(offenders).toEqual([])
  })
})
