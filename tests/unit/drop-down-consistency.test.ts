import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

/*
 * Every drop-down in Ostler looks the same (MOP-33). A list that opens is one
 * of Ostler's own: Select (a native select drawn like a menu), Combobox or
 * SuggestField, or Menu. These checks fail when a screen draws its own, or
 * lets Windows draw one.
 */

const RENDERER = join(__dirname, '..', '..', 'src', 'renderer')

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, out)
    else if (/\.(tsx|ts)$/.test(name)) out.push(path)
  }
  return out
}

const sources = files(RENDERER).map((path) => ({
  path: relative(RENDERER, path).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8')
}))

/** Files whose text matches `pattern`, minus `allowed`. */
function offenders(pattern: RegExp, allowed: readonly string[]): string[] {
  return sources
    .filter((file) => pattern.test(file.text) && !allowed.includes(file.path))
    .map((file) => file.path)
}

/** The CSS declarations of the rules whose selector is exactly `selector`, as a map. */
function declarations(css: string, selector: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const [, head, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (head.replace(/\/\*[\s\S]*?\*\//g, '').trim() !== selector) continue
    for (const line of body.split(';')) {
      const colon = line.indexOf(':')
      if (colon > 0) map.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
    }
  }
  expect(map.size, `${selector} is missing`).toBeGreaterThan(0)
  return map
}

describe('drop-downs look the same everywhere (MOP-33)', () => {
  it('renders a native <select> only inside the Select component', () => {
    expect(offenders(/^\s*<select[\s>]/m, ['ui/Select.tsx'])).toEqual([])
  })

  it('uses no <datalist>, whose list Windows draws: use SuggestField', () => {
    expect(offenders(/^\s*<datalist[\s>]/m, [])).toEqual([])
  })

  it('draws a menu only through Menu', () => {
    expect(offenders(/^\s*role=["']menu["']/m, ['ui/Menu.tsx'])).toEqual([])
  })

  it('draws a pick-one list only through Combobox, or one of the known search lists', () => {
    // Search results that stay open under a search box, not drop-downs.
    const searchLists = [
      'ui/Combobox.tsx',
      'components/CommandPalette.tsx',
      'components/whiteboard/LinkDialog.tsx',
      'hooks/useItemLinkPicker.tsx',
      'views/search/SearchView.tsx'
    ]
    expect(offenders(/^\s*role=["']listbox["']/m, searchLists)).toEqual([])
  })

  it("keeps Select's open list on the same surface as Ostler's menus", () => {
    const select = readFileSync(join(RENDERER, 'ui', 'Select.css'), 'utf8')
    const overlay = readFileSync(join(RENDERER, 'ui', 'overlay', 'overlay.css'), 'utf8')
    expect(select).toMatch(/appearance:\s*base-select/)
    const picker = declarations(select, '.ui-select > select::picker(select)')
    const menu = declarations(overlay, '.ui-floating')
    for (const property of ['background', 'color', 'border', 'border-radius', 'box-shadow']) {
      expect(picker.get(property), property).toBe(menu.get(property))
    }
  })
})
