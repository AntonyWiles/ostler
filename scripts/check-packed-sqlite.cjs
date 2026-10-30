/**
 * electron-builder's afterPack hook: the packed app must be able to open a database before an
 * installer is made from it. It starts the packed executable as Node (ELECTRON_RUN_AS_NODE), loads
 * better-sqlite3 from the packed app.asar the way the app does, and opens an in-memory database.
 * A better-sqlite3 built for plain Node (left by `npm run rebuild:test`) fails here with a
 * NODE_MODULE_VERSION mismatch, and the build stops instead of shipping an Ostler that can't start.
 *
 * Also runnable by hand against an unpacked app: `node scripts/check-packed-sqlite.cjs dist/ostler/win-unpacked`.
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

/** Run inside the packed executable: loads the packed module and opens a database. */
const PROBE = `
const Database = require(process.argv[1])
const db = new Database(':memory:')
db.prepare('SELECT 1').get()
db.close()
process.stdout.write('ok ' + process.versions.modules)
`

/** The packed executable in `appOutDir`, or null for a platform this host can't run. */
function executableIn(appOutDir, productFilename) {
  if (process.platform === 'win32') return path.join(appOutDir, `${productFilename}.exe`)
  if (process.platform === 'linux') {
    const candidates = fs
      .readdirSync(appOutDir)
      .filter((name) => !path.extname(name) && fs.statSync(path.join(appOutDir, name)).isFile())
    const named = candidates.find((name) => name.toLowerCase() === productFilename.toLowerCase())
    return named ? path.join(appOutDir, named) : null
  }
  return null
}

/** Throws with the reason when the packed app in `appOutDir` can't open a database. */
function checkPackedSqlite(appOutDir, productFilename) {
  const executable = executableIn(appOutDir, productFilename)
  if (!executable || !fs.existsSync(executable)) {
    process.stdout.write(
      `check-packed-sqlite: no ${productFilename} executable to run here; skipped\n`
    )
    return
  }
  const modulePath = path.join(appOutDir, 'resources', 'app.asar', 'node_modules', 'better-sqlite3')
  const result = spawnSync(executable, ['-e', PROBE, modulePath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true
  })
  if (result.status === 0 && result.stdout.startsWith('ok ')) {
    const abi = result.stdout.slice(3).trim()
    process.stdout.write(`check-packed-sqlite: the packed app opens a database (ABI ${abi})\n`)
    return
  }
  const output = [result.error?.message, result.stderr, result.stdout]
    .filter(Boolean)
    .join('\n')
    .trim()
  throw new Error(
    'The packed app cannot open its database: better-sqlite3 is not built for its Electron.\n' +
      'Run `npm run rebuild:native`, then package again.\n\n' +
      output
  )
}

module.exports = async function afterPack(context) {
  checkPackedSqlite(context.appOutDir, context.packager.appInfo.productFilename)
}
module.exports.checkPackedSqlite = checkPackedSqlite

if (require.main === module) {
  const appOutDir = path.resolve(process.argv[2] ?? 'dist/ostler/win-unpacked')
  try {
    checkPackedSqlite(appOutDir, process.argv[3] ?? 'Ostler')
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}
