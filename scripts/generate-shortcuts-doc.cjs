/*
 * Writes the user guide's keyboard shortcuts page from the shortcut table
 * (src/shared/shortcuts.ts), so the page and the app cannot
 * drift: `npm run docs:shortcuts` writes it, and `npm run lint` runs this with
 * --check, which fails when the committed page is out of date.
 */
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { parseArgs } = require('./lib/args.cjs')
const { projectRoot } = require('./lib/root.cjs')

const TABLE = path.join(projectRoot, 'src', 'shared', 'shortcuts.ts')
// The page is English: the labels come from the English strings (P11.1).
const STRINGS = path.join(projectRoot, 'src', 'shared', 'locales', 'en', 'navigation.json')
const PAGE = path.join(projectRoot, 'docs', 'user-guide', '16-keyboard-shortcuts.md')

/**
 * Loads the table module (it has no imports, so transpiling it is enough) and
 * labels its groups and entries from the English strings.
 */
function loadTable(file = TABLE, stringsFile = STRINGS) {
  const source = fs.readFileSync(file, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  })
  const module = { exports: {} }
  new Function('module', 'exports', outputText)(module, module.exports)
  const table = module.exports
  const strings = JSON.parse(fs.readFileSync(stringsFile, 'utf8'))
  const t = (key) => {
    const value = key
      .split(':')[1]
      .split('.')
      .reduce((node, part) => (node ? node[part] : undefined), strings)
    if (typeof value !== 'string') throw new Error(`No English string for ${key}`)
    return value
  }
  return {
    ...table,
    markupHeading: t('navigation:markupShortcutsHeading'),
    markupShortcuts: (table.MARKUP_SHORTCUTS ?? []).map((entry) => ({
      ...entry,
      label: t(table.markupShortcutLabelKey(entry.id))
    })),
    whiteboardHeading: t('navigation:whiteboardShortcutsHeading'),
    whiteboardShortcuts: (table.WHITEBOARD_SHORTCUTS ?? []).map((entry) => ({
      ...entry,
      label: t(table.whiteboardShortcutLabelKey(entry.id))
    })),
    shortcutGroups: () =>
      table.shortcutGroups().map((group) => ({
        ...group,
        label: t(table.shortcutGroupLabelKey(group.id)),
        shortcuts: group.shortcuts.map((entry) => ({
          ...entry,
          label: t(table.shortcutLabelKey(entry.id))
        }))
      }))
  }
}

/** "G then H" → "`G` then `H`"; "Ctrl+K" → "`Ctrl` + `K`". */
function keysMarkdown(keys) {
  return keys
    .split(/ (then|or) /)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .split(/\+(?!$)/)
            .map((key) => `\`${key}\``)
            .join(' + ')
    )
    .join(' ')
}

/** The page's markdown for a loaded table. */
function renderPage(table) {
  const lines = [
    '# Keyboard shortcuts',
    '',
    '<!-- Generated from src/shared/shortcuts.ts by `npm run docs:shortcuts`. Do not edit by hand. -->',
    '',
    'Press `?` anywhere to see this list in the app, with a search box. Single-key shortcuts work when',
    "you aren't typing in a field and no dialog is open.",
    ''
  ]
  for (const group of table.shortcutGroups()) {
    // A list, not a table: the app renders the guide without table support.
    lines.push(`## ${group.label}`, '')
    for (const entry of group.shortcuts) {
      lines.push(`- ${keysMarkdown(entry.keys)}: ${entry.label}`)
    }
    lines.push('')
  }
  // Mark up a picture (N4.2b): keys that work only inside its editor.
  if (table.markupShortcuts && table.markupShortcuts.length > 0) {
    lines.push(`## ${table.markupHeading}`, '')
    for (const entry of table.markupShortcuts) {
      lines.push(`- ${keysMarkdown(entry.keys)}: ${entry.label}`)
    }
    lines.push('')
  }
  // Whiteboards (docs/plans/whiteboards): keys that work only inside the whiteboard editor.
  if (table.whiteboardShortcuts && table.whiteboardShortcuts.length > 0) {
    lines.push(`## ${table.whiteboardHeading}`, '')
    for (const entry of table.whiteboardShortcuts) {
      lines.push(`- ${keysMarkdown(entry.keys)}: ${entry.label}`)
    }
    lines.push('')
  }
  lines.push(
    '## From any app',
    '',
    'These keys work while you are in another app, once you turn them on in Settings › General.',
    'Both start off, and you choose the keys.',
    '',
    '- **Quick add from anywhere** (`Ctrl` + `Alt` + `N` suggested): opens quick add',
    '- **Snip to task** (`Ctrl` + `Alt` + `S` suggested): drag a rectangle on the screen, and quick',
    '  add opens with the picture. `Enter` takes the whole screen; `Esc` or a right click cancels',
    '',
    'Tooltips in the app show the same keys. In menus, the keys for an item are shown on its right.',
    ''
  )
  return lines.join('\n')
}

function main(argv) {
  const check = parseArgs(argv).has('--check')
  const expected = renderPage(loadTable())
  if (check) {
    const actual = fs.existsSync(PAGE) ? fs.readFileSync(PAGE, 'utf8').replace(/\r\n/g, '\n') : ''
    if (actual !== expected) {
      process.stderr.write(
        `generate-shortcuts-doc: ${path.relative(projectRoot, PAGE)} is out of date with the shortcut table. Run \`npm run docs:shortcuts\`.\n`
      )
      return 1
    }
    return 0
  }
  fs.writeFileSync(PAGE, expected)
  process.stdout.write(`Wrote ${path.relative(projectRoot, PAGE)}\n`)
  return 0
}

if (require.main === module) process.exitCode = main(process.argv.slice(2))

module.exports = { loadTable, renderPage, keysMarkdown, PAGE }
