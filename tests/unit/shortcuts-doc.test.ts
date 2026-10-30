import fs from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { t } from '../../src/shared/i18n'
import { SHORTCUTS, shortcutLabelKey } from '../../src/shared/shortcuts'

const require = createRequire(import.meta.url)
type LabelledGroups = () => {
  id: string
  label: string
  shortcuts: { id: string; keys: string; label: string }[]
}[]

const generator = require('../../scripts/generate-shortcuts-doc.cjs') as {
  loadTable(): { shortcutGroups: LabelledGroups }
  renderPage(table: { shortcutGroups: LabelledGroups }): string
  PAGE: string
}

describe('the generated keyboard shortcuts page (P8.1)', () => {
  const committed = () => fs.readFileSync(generator.PAGE, 'utf8').replace(/\r\n/g, '\n')

  it('matches the shortcut table', () => {
    expect(committed()).toBe(generator.renderPage(generator.loadTable()))
  })

  it('lists every shortcut that works today, and none that does not', () => {
    const page = committed()
    for (const entry of SHORTCUTS) {
      const listed = page.includes(`: ${t(shortcutLabelKey(entry.id))}
`)
      expect(listed, entry.id).toBe(!('since' in entry))
    }
  })

  it('stops matching when the table changes', () => {
    const changed = {
      shortcutGroups: () =>
        generator
          .loadTable()
          .shortcutGroups()
          .map((group) => ({
            ...group,
            shortcuts: group.shortcuts.map((entry) =>
              entry.id === 'palette' ? { ...entry, keys: 'Ctrl+P' } : entry
            )
          }))
    }
    expect(generator.renderPage(changed)).not.toBe(committed())
  })
})
