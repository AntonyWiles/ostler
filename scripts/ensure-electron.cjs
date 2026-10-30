/*
 * Makes sure Electron's binary is installed, once, before anything runs in parallel.
 *
 * `npm ci` installs the `electron` package without its binary: the package's
 * `index.js` downloads and unpacks it into `node_modules/electron/dist` the
 * first time it is required. When several test workers did that at once, each
 * unpacked into the same folder and they broke one another ("os error 183",
 * "Electron failed to install correctly"). Vitest's and Playwright's global
 * setups call this in their main process, before any worker starts.
 *
 * `node scripts/ensure-electron.cjs` does the same from the command line.
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function defaultElectronDir() {
  return path.dirname(require.resolve('electron/package.json'))
}

/** The binary `path.txt` points at, or null while it is not installed. */
function installedBinary(electronDir) {
  const pathFile = path.join(electronDir, 'path.txt')
  if (!fs.existsSync(pathFile)) return null
  const binary = path.join(electronDir, 'dist', fs.readFileSync(pathFile, 'utf8').trim())
  return fs.existsSync(binary) ? binary : null
}

/**
 * Runs Electron's own installer (it does nothing when the binary is already
 * there) and returns the binary's path. Throws a clear error when the binary
 * is still missing afterwards.
 */
function ensureElectronBinary(electronDir = defaultElectronDir()) {
  const installer = path.join(electronDir, 'install.js')
  const result = spawnSync(process.execPath, [installer], { cwd: electronDir, stdio: 'inherit' })
  const binary = installedBinary(electronDir)
  if (result.status === 0 && binary) return binary
  const reason = result.error
    ? result.error.message
    : result.status !== 0
      ? `its installer exited with code ${result.status}`
      : 'its installer finished but no binary is in dist'
  throw new Error(
    `Electron's binary is not installed in ${path.join(electronDir, 'dist')} (${reason}). ` +
      'Check the network connection, then delete node_modules/electron and run `npm ci` again.'
  )
}

module.exports = { ensureElectronBinary, installedBinary }

if (require.main === module) {
  try {
    process.stdout.write(`Electron binary: ${ensureElectronBinary()}\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}
