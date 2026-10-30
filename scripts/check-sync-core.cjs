/*
 * Fails when a core file of the sync engine imports anything at run time that the phone
 * can't supply. The phone (the Android app) reuses these files and replaces
 * `electron/services/sync/platform.ts` through a Metro alias, so a core file may import only
 * other core files, `./platform`, `./transport-paths`, `../change-history/table-shape`, an
 * `@shared/` path, or types (`import type`). Node and Electron services go through `./platform`.
 */
const fs = require('node:fs')
const path = require('node:path')
const { projectRoot } = require('./lib/root.cjs')

const CORE = [
  'apply',
  'capture',
  'change-file',
  'envelope',
  'leaving',
  'pairing',
  'library-files',
  'person-links',
  'records',
  'roles',
  'rotation',
  'settings-sync',
  'sharing',
  'snapshot-file',
  'snapshots',
  'sync-keys',
  'sync-runner',
  'synced-tables',
  'task-numbers',
  'http-transport',
  'drive-client',
  'drive-transport',
  'drive-changes',
  'invite-message',
  'joined-project'
]

const directory = path.join(projectRoot, 'electron', 'services', 'sync')
const ALLOWED = new Set(['./platform', './transport-paths', '../change-history/table-shape'])
const coreSpecifiers = new Set(CORE.map((name) => `./${name}`))

function allowed(specifier) {
  return ALLOWED.has(specifier) || coreSpecifiers.has(specifier) || specifier.startsWith('@shared/')
}

/** Blanks comments so a quoted `from '…'` inside one is not read as an import. */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/** True for `import type …`, `export type …` and `{ type A, type B }` (erased at run time). */
function typeOnly(clause) {
  const text = clause.trim()
  if (/^type\s/.test(text)) return true
  const named = /^\{([\s\S]*)\}$/.exec(text)
  if (!named) return false
  const parts = named[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length > 0 && parts.every((part) => /^type\s/.test(part))
}

const problems = []
for (const name of CORE) {
  const file = path.join(directory, `${name}.ts`)
  if (!fs.existsSync(file)) {
    problems.push(`${name}.ts: listed as a core file but missing`)
    continue
  }
  const source = withoutComments(fs.readFileSync(file, 'utf8'))
  const found = []
  const fromPattern = /(?:^|\n)\s*(?:import|export)\s+([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/g
  for (let match = fromPattern.exec(source); match; match = fromPattern.exec(source)) {
    if (!typeOnly(match[1])) found.push(match[2])
  }
  const barePattern = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
  for (let match = barePattern.exec(source); match; match = barePattern.exec(source)) {
    found.push(match[1])
  }
  const dynamicPattern = /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]/g
  for (let match = dynamicPattern.exec(source); match; match = dynamicPattern.exec(source)) {
    found.push(match[1])
  }
  for (const specifier of found) {
    if (!allowed(specifier)) problems.push(`${name}.ts: runtime import of '${specifier}'`)
  }
}

if (problems.length > 0) {
  process.stderr.write(
    `Sync core files import something the phone can't supply:\n  ${problems.join('\n  ')}\n` +
      "Import Node and Electron services from './platform' (electron/services/sync/platform.ts), or make the import type-only.\n"
  )
  process.exitCode = 1
}
