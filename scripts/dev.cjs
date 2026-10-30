/*
 * Development launcher that mirrors output to a persistent log without
 * changing the normal interactive `npm run dev` experience.
 *
 * `npm run dev -- --fresh` (or `npm run dev:fresh`) starts Ostler as a new
 * install sees it, every time: the data folder C:\temp\ostler-roadmap\fresh-install
 * is emptied first and no config.json is written, so the welcome, the
 * new-install config migrations and empty browser storage all run as on a
 * person's first start. Your own data folder is never touched.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { scratchDataDir, assertDeletable } = require('./scratch-paths.cjs')

const projectRoot = path.resolve(__dirname, '..')
const defaultUserDataDirectory = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'ostler'
)
const fresh = process.argv.slice(2).includes('--fresh')
const freshDirectory = scratchDataDir('fresh-install')
if (fresh) {
  try {
    fs.rmSync(assertDeletable(freshDirectory), { recursive: true, force: true })
  } catch (error) {
    process.stderr.write(
      `Could not empty ${freshDirectory} (${error.code || error.message}).\n` +
        'Close the Ostler window from the last fresh run, then run it again.\n'
    )
    process.exit(1)
  }
  process.env.OSTLER_USER_DATA = freshDirectory
}
const dataDirectory = process.env.OSTLER_USER_DATA || defaultUserDataDirectory
const logDirectory = path.join(dataDirectory, 'logs')
const logPath = path.join(logDirectory, 'dev.log')
const nativeBindingPath = path.join(
  projectRoot,
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
)
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npmExecPath = process.env.npm_execpath

fs.mkdirSync(logDirectory, { recursive: true })
const log = fs.createWriteStream(logPath, { flags: 'a' })

function write(chunk, stream) {
  stream.write(chunk)
  log.write(chunk)
}

function header(message) {
  const line = `\n[${new Date().toISOString()}] ${message}\n`
  write(line, process.stdout)
}

function run(command, args) {
  const childEnvironment = { ...process.env }
  // Codex and some terminal hosts set this while invoking Electron-backed
  // tooling. Ostler itself must launch Electron in desktop mode, not as Node.
  delete childEnvironment.ELECTRON_RUN_AS_NODE
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: childEnvironment,
    stdio: ['inherit', 'pipe', 'pipe'],
    // npm is a .cmd shim on Windows and must be launched through cmd.exe.
    shell: process.platform === 'win32' && command === npmCommand
  })

  child.stdout.on('data', (chunk) => write(chunk, process.stdout))
  child.stderr.on('data', (chunk) => write(chunk, process.stderr))
  child.on('error', (error) => write(`${error.stack || error}\n`, process.stderr))
  return child
}

function runNpm(args) {
  // npm exposes its CLI path to scripts. Running that file with Node avoids
  // spawning npm.cmd through a shell on Windows.
  if (npmExecPath) return run(process.execPath, [npmExecPath, ...args])
  return run(npmCommand, args)
}

async function waitForExit(child) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    child.once('exit', (code, signal) => finish({ code, signal }))
    child.once('error', () => finish({ code: 1, signal: null }))
  })
}

/**
 * True while another Ostler started from this checkout (your usual
 * `npm run dev`) has the native binding loaded. It is then already built for
 * Electron, and Windows refuses to replace it, so the rebuild is skipped.
 */
function nativeBindingInUse() {
  if (process.platform !== 'win32' || !fs.existsSync(nativeBindingPath)) return false
  try {
    fs.closeSync(fs.openSync(nativeBindingPath, 'r+'))
    return false
  } catch (error) {
    return Boolean(error && ['EBUSY', 'EPERM', 'EACCES'].includes(error.code))
  }
}

async function main() {
  header(fresh ? 'npm run dev --fresh started (a new install)' : 'npm run dev started')
  if (fresh) write(`Fresh install: data in ${freshDirectory}, emptied first\n`, process.stdout)
  write(`Writing development output to ${logPath}\n`, process.stdout)

  let rebuildResult = { code: 0, signal: null }
  if (nativeBindingInUse()) {
    write(
      'Native binding in use by a running Ostler: already built, rebuild skipped\n',
      process.stdout
    )
  } else {
    rebuildResult = await waitForExit(runNpm(['run', 'rebuild:native']))
  }
  if (rebuildResult.code !== 0) {
    header(
      `native rebuild failed (exit ${rebuildResult.code ?? rebuildResult.signal ?? 'unknown'})`
    )
    process.exitCode = rebuildResult.code || 1
    log.end()
    return
  }

  // Settings › About › Open source licences reads out/THIRD_PARTY_NOTICES.md.
  const notices = runNpm(['run', 'notices'])
  const noticesResult = await waitForExit(notices)
  if (noticesResult.code !== 0) {
    header(
      `third-party notices failed (exit ${noticesResult.code ?? noticesResult.signal ?? 'unknown'})`
    )
  }

  const devServer = runNpm(['exec', 'electron-vite', '--', 'dev'])
  const forwardSignal = (signal) => {
    if (!devServer.killed) devServer.kill(signal)
  }
  process.once('SIGINT', () => forwardSignal('SIGINT'))
  process.once('SIGTERM', () => forwardSignal('SIGTERM'))

  const result = await waitForExit(devServer)
  header(`electron-vite dev stopped (exit ${result.code ?? result.signal ?? 'unknown'})`)
  process.exitCode = result.code || 0
  log.end()
}

main().catch((error) => {
  write(`${error.stack || error}\n`, process.stderr)
  log.end()
  process.exitCode = 1
})
