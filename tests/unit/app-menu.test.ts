import { describe, expect, it } from 'vitest'
import {
  buildMenuTemplate,
  menuShape,
  setMenuEnabled,
  type EnablableMenuItem,
  toElectronTemplate,
  type MenuTemplateItem
} from '../../electron/app/desktop/app-menu'
import { EMPTY_MENU_CONTEXT, type MenuContext } from '../../src/shared/ostler-api'
import { SHORTCUTS, menuAccelerator } from '../../src/shared/shortcuts'

const PROJECT_CONTEXT: MenuContext = {
  project: { id: '0f8fad5b-d9cb-469f-a165-70867728950e', name: 'Website' },
  views: [
    { id: 'overview', label: 'Overview', keys: 'Ctrl+1' },
    { id: 'board', label: 'Board', keys: 'Ctrl+2' },
    { id: 'archive', label: 'Archive' }
  ],
  viewIds: ['overview', 'board', 'archive'],
  printable: true,
  recentProjectIds: []
}

function flatten(items: MenuTemplateItem[]): MenuTemplateItem[] {
  return items.flatMap((item) => [item, ...flatten(item.submenu ?? [])])
}

describe('buildMenuTemplate', () => {
  it('builds File, Edit, View, Go and Help from the shared table (snapshot)', () => {
    expect(
      buildMenuTemplate({ context: PROJECT_CONTEXT, theme: 'system', isDev: false })
    ).toMatchSnapshot()
  })

  it('shows each shortcut item with the key the table gives it, and does not register it', () => {
    const items = flatten(
      buildMenuTemplate({ context: PROJECT_CONTEXT, theme: 'system', isDev: false })
    )
    const shortcutItems = items.filter((item) => item.command?.kind === 'shortcut')
    expect(shortcutItems.length).toBeGreaterThan(5)
    for (const item of shortcutItems) {
      const id = item.command?.kind === 'shortcut' ? item.command.id : ''
      const entry = SHORTCUTS.find((candidate) => candidate.id === id)
      expect(entry, id).toBeDefined()
      const accelerator = menuAccelerator(entry!.keys)
      expect(item.accelerator ?? null, id).toBe(accelerator)
      if (accelerator) expect(item.registerAccelerator, id).toBe(false)
    }
  })

  it('shows keys in Electron accelerator form', () => {
    expect(menuAccelerator('Ctrl+K')).toBe('CmdOrCtrl+K')
    expect(menuAccelerator('Ctrl+Shift+N')).toBe('CmdOrCtrl+Shift+N')
    expect(menuAccelerator('G then H')).toBeNull()
    expect(menuAccelerator('Ctrl+1–9')).toBeNull()
    expect(menuAccelerator('?')).toBeNull()
  })

  it('offers Reload and DevTools only in development', () => {
    const roles = (isDev: boolean) =>
      flatten(buildMenuTemplate({ context: EMPTY_MENU_CONTEXT, theme: 'light', isDev })).map(
        (item) => item.role
      )
    expect(roles(false)).not.toContain('toggleDevTools')
    expect(roles(false)).not.toContain('reload')
    expect(roles(true)).toContain('toggleDevTools')
    expect(roles(true)).toContain('reload')
  })

  it('disables Export and Print outside a project, lists no views, and checks the theme', () => {
    const items = flatten(
      buildMenuTemplate({ context: EMPTY_MENU_CONTEXT, theme: 'dark', isDev: false })
    )
    expect(items.find((item) => item.label === 'Export…')?.enabled).toBe(false)
    expect(items.find((item) => item.label === 'Print…')?.enabled).toBe(false)
    expect(items.some((item) => item.command?.kind === 'open-view')).toBe(false)
    const theme = items.find((item) => item.label === 'Theme')
    expect(theme?.submenu?.map((item) => [item.label, item.checked])).toEqual([
      ['System', false],
      ['Light', false],
      ['Dark', true]
    ])
  })

  it('wires each command to the one channel', () => {
    const sent: unknown[] = []
    const template = toElectronTemplate(
      buildMenuTemplate({ context: PROJECT_CONTEXT, theme: 'system', isDev: false }),
      (command) => sent.push(command)
    )
    const go = template.find((item) => item.label === '&Go')
    const board = (go?.submenu as Electron.MenuItemConstructorOptions[]).find(
      (item) => item.label === 'Board'
    )
    board?.click?.({} as never, undefined, {} as never)
    expect(sent).toEqual([{ kind: 'open-view', view: 'board' }])
  })

  it('zooms in main, with Ctrl+=, Ctrl+- and Ctrl+0 registered, and Ctrl++ and the number pad too', () => {
    const steps: unknown[] = []
    const template = toElectronTemplate(
      buildMenuTemplate({ context: EMPTY_MENU_CONTEXT, theme: 'system', isDev: false }),
      () => {},
      (step) => steps.push(step)
    )
    const view = (template.find((item) => item.label === '&View')?.submenu ??
      []) as Electron.MenuItemConstructorOptions[]
    const zoomItems = view.filter((item) => /zoom/i.test(String(item.label)))
    expect(
      zoomItems.filter((item) => item.visible !== false).map((item) => item.accelerator)
    ).toEqual(['CmdOrCtrl+=', 'CmdOrCtrl+-', 'CmdOrCtrl+0'])
    for (const item of zoomItems) {
      expect(item.role).toBeUndefined()
      expect(item.registerAccelerator).not.toBe(false)
      item.click?.({} as never, undefined, {} as never)
    }
    expect(steps).toEqual(['in', 'out', 'reset', 'in', 'in', 'out', 'reset'])
  })
})

describe('menuShape and setMenuEnabled', () => {
  const printable = buildMenuTemplate({ context: PROJECT_CONTEXT, theme: 'system', isDev: false })
  const notPrintable = buildMenuTemplate({
    context: { ...PROJECT_CONTEXT, printable: false },
    theme: 'system',
    isDev: false
  })

  it('gives menus that differ only in enabled items the same shape', () => {
    expect(menuShape(notPrintable)).toBe(menuShape(printable))
    expect(
      menuShape(buildMenuTemplate({ context: EMPTY_MENU_CONTEXT, theme: 'system', isDev: false }))
    ).not.toBe(menuShape(printable))
  })

  it('sets the installed items to the new template’s enabled states', () => {
    const install = (items: MenuTemplateItem[]): EnablableMenuItem[] =>
      items.map((item) => ({
        enabled: item.enabled ?? true,
        submenu: item.submenu ? { items: install(item.submenu) } : null
      }))
    const installed = install(printable)
    setMenuEnabled(installed, notPrintable)
    expect(installed).toEqual(install(notPrintable))
  })
})
