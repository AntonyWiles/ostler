import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Layout rules for the phone's screens, checked in the source so they hold as features are
 * added. Controls never sit in a row you swipe sideways: one of many is a `Dropdown`, a screen's
 * sections are in its side menu (`TopBar` `nav`), and a few short choices wrap.
 */

const root = join(__dirname, '..')
const screens = join(root, 'src', 'screens')
const files = [
  join(root, 'App.tsx'),
  ...readdirSync(screens)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => join(screens, name))
]

/** Wide content, not controls: a Markdown table scrolls sideways like a table on the desktop. */
const SIDEWAYS_ALLOWED = new Set(['Markdown.tsx'])

/** The most choices a wrapped row of chips may offer before it should be a dropdown. */
const MOST_CHIPS_IN_A_CHOICE = 4

describe('mobile design rules', () => {
  it.each(files.map((file) => [file.slice(root.length + 1), file]))(
    '%s has no sideways-scrolling rows',
    (_name, file) => {
      if (SIDEWAYS_ALLOWED.has(file.split(/[\\/]/).pop() ?? '')) return
      const source = readFileSync(file, 'utf8')
      expect(source).not.toMatch(/<(ScrollView|FlatList|SectionList)\b[^>]*\bhorizontal\b/)
    }
  )

  it.each(files.map((file) => [file.slice(root.length + 1), file]))(
    '%s picks from long lists with a dropdown, not chips',
    (_name, file) => {
      const source = readFileSync(file, 'utf8')
      // A row of chips built from a fixed list longer than a few entries.
      for (const match of source.matchAll(
        /\[([^[\]]*)\](?: as const)?\.map\(\([^)]*\) => \(?\s*<Chip/g
      )) {
        const entries = match[1].split(',').filter((entry) => entry.trim() !== '')
        expect(entries.length).toBeLessThanOrEqual(MOST_CHIPS_IN_A_CHOICE)
      }
    }
  )
})
