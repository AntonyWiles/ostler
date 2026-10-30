import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  paletteSettingsGroups,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  settingsGroupLabel,
  type ViewContext
} from '@renderer/navigation/registry'

const RENDERER = resolve(__dirname, '../../../src/renderer')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : entry.name.endsWith('.tsx')
        ? [join(dir, entry.name)]
        : []
  )
}

/** Every `<SettingsGroup id="…">` in the renderer: the ids its groups use. */
function usedGroupIds(): { ids: string[]; withoutId: string[] } {
  const ids: string[] = []
  const withoutId: string[] = []
  for (const file of sourceFiles(RENDERER)) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/<SettingsGroup\b([^>]*?)(?:\n|>)/g)) {
      // The id is on the tag's first line or the next few: read up to the tag's end.
      const tag = source.slice(match.index, match.index + 400)
      const id = /\bid="([^"]+)"/.exec(tag)?.[1]
      if (id) ids.push(id)
      else withoutId.push(file)
    }
  }
  return { ids, withoutId }
}

const everything: ViewContext = { hasFolder: false, agents: true, ai: true }
const nothing: ViewContext = { hasFolder: false, agents: false, ai: false }

describe('settings groups', () => {
  it('have unique ids, on a section that exists, with a heading', () => {
    const ids = SETTINGS_GROUPS.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    const sections = new Set<string>(SETTINGS_SECTIONS.map((entry) => entry.id))
    for (const entry of SETTINGS_GROUPS) {
      expect(sections.has(entry.section), entry.id).toBe(true)
      expect(entry.label.trim(), entry.id).not.toBe('')
    }
  })

  it('are the only groups the settings pages use, and every one is used', () => {
    const { ids, withoutId } = usedGroupIds()
    expect(withoutId).toEqual([])
    const registered = new Set<string>(SETTINGS_GROUPS.map((entry) => entry.id))
    expect(ids.filter((id) => !registered.has(id))).toEqual([])
    const used = new Set(ids)
    expect([...registered].filter((id) => !used.has(id))).toEqual([])
  })

  it('give a group its heading by id', () => {
    expect(settingsGroupLabel('email-server')).toBe(
      SETTINGS_GROUPS.find((entry) => entry.id === 'email-server')!.label
    )
  })

  it('are offered by the palette by their words, not only their section', () => {
    const offered = paletteSettingsGroups(everything)
    const email = offered.find((entry) => entry.id === 'email-server')
    expect(email?.section).toBe('connections')
    expect(email?.keywords).toContain('SMTP')
    expect(offered.some((entry) => entry.id === 'backups')).toBe(true)
  })

  it('leave out a group that is a state of another, or the only one in its section', () => {
    const offered = paletteSettingsGroups(everything).map((entry) => entry.id)
    for (const id of ['git', 'people', 'projects', 'ai-not-set-up', 'automation-projects']) {
      expect(offered, id).not.toContain(id)
    }
  })

  it('follow the context their section needs', () => {
    const offered = paletteSettingsGroups(nothing).map((entry) => entry.id)
    expect(offered).toContain('email-server')
    for (const id of ['built-in-agent', 'agent-copies', 'version-history', 'ai-chat']) {
      expect(offered, id).not.toContain(id)
    }
  })
})
