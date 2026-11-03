/*
 * Windows names a process in Task Manager after its exe's file description,
 * so `npm run dev` running node_modules' electron.exe shows up as "Electron".
 * This keeps a copy of the Electron runtime in node_modules/.cache with the
 * exe renamed to Ostler.exe and its name and icon set to Ostler's, the way the
 * packaged app is built. electron-vite starts it through ELECTRON_EXEC_PATH.
 *
 * The copy is made again whenever the installed Electron version changes.
 * Files other than the exe are hard links where the drive allows it, so the
 * copy takes almost no extra space.
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const iconPath = path.join(projectRoot, 'build', 'icons', 'icon.ico')

function findRcedit() {
  // electron-builder brings rcedit in through electron-winstaller.
  try {
    const winstaller = path.dirname(
      require.resolve('electron-winstaller/package.json', { paths: [projectRoot] })
    )
    const exe = path.join(winstaller, 'vendor', 'rcedit.exe')
    return fs.existsSync(exe) ? exe : null
  } catch {
    return null
  }
}

function linkOrCopy(source, target) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true })
      linkOrCopy(from, to)
    } else {
      try {
        fs.linkSync(from, to)
      } catch {
        fs.copyFileSync(from, to)
      }
    }
  }
}

/** Path of the Ostler-named Electron exe, or null to use the stock one. */
function brandedElectronPath(log) {
  if (process.platform !== 'win32') return null
  const electronRoot = path.join(projectRoot, 'node_modules', 'electron')
  const distDirectory = path.join(electronRoot, 'dist')
  const stockExe = path.join(distDirectory, 'electron.exe')
  const rcedit = findRcedit()
  if (!fs.existsSync(stockExe) || !rcedit) {
    log('Ostler-named Electron not available, using electron.exe\n')
    return null
  }

  const { version } = JSON.parse(fs.readFileSync(path.join(electronRoot, 'package.json'), 'utf8'))
  const cacheDirectory = path.join(projectRoot, 'node_modules', '.cache', 'ostler-electron')
  const brandedExe = path.join(cacheDirectory, 'Ostler.exe')
  const stampPath = path.join(cacheDirectory, 'electron-version.txt')
  const stamp = `${version}\n${fs.statSync(iconPath, { throwIfNoEntry: false })?.mtimeMs ?? 0}`
  const current = fs.existsSync(stampPath) && fs.readFileSync(stampPath, 'utf8') === stamp
  if (current && fs.existsSync(brandedExe)) return brandedExe

  try {
    fs.rmSync(cacheDirectory, { recursive: true, force: true })
    fs.mkdirSync(cacheDirectory, { recursive: true })
    linkOrCopy(distDirectory, cacheDirectory)
    // The exe itself is a real copy, since rcedit rewrites it in place.
    fs.rmSync(path.join(cacheDirectory, 'electron.exe'))
    fs.copyFileSync(stockExe, brandedExe)
    const args = [
      brandedExe,
      '--set-version-string',
      'FileDescription',
      'Ostler',
      '--set-version-string',
      'ProductName',
      'Ostler',
      '--set-version-string',
      'InternalName',
      'Ostler',
      '--set-version-string',
      'OriginalFilename',
      'Ostler.exe'
    ]
    if (fs.existsSync(iconPath)) args.push('--set-icon', iconPath)
    execFileSync(rcedit, args, { stdio: 'ignore' })
    fs.writeFileSync(stampPath, stamp)
    log(`Prepared Ostler-named Electron ${version}\n`)
    return brandedExe
  } catch (error) {
    // A running dev Ostler holds the files open; keep using what is there.
    if (fs.existsSync(brandedExe) && fs.existsSync(stampPath)) return brandedExe
    log(
      `Could not prepare Ostler-named Electron (${error.code || error.message}), using electron.exe\n`
    )
    return null
  }
}

module.exports = { brandedElectronPath }
