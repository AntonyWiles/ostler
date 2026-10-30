/*
 * `node scripts/monkey-drive.cjs <command> [key=value ...]`: sends one command
 * to a monkey running in drive mode (`npm run monkey -- drive`, or a journey
 * with --keep-open) and prints the answer. It finds the newest run's
 * drive.json by itself; --run <folder> or --port <n> picks another.
 *
 *   node scripts/monkey-drive.cjs snapshot
 *   node scripts/monkey-drive.cjs click role=button "name=New task"
 *   node scripts/monkey-drive.cjs fill label=Title "value=Write the README"
 *   node scripts/monkey-drive.cjs click role=button name=Save within.dialog="New task"
 *   node scripts/monkey-drive.cjs note kind=hard severity=S3 "title=..." "details=..."
 *
 * Values that look like numbers, true/false or JSON are sent as such; a key
 * with a dot (within.dialog=...) builds a nested object.
 */
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { URL } = require('node:url')
const { Buffer } = require('node:buffer')
const { SCRATCH_ROOT } = require('./scratch-paths.cjs')

const GETS = new Set(['', 'state', 'snapshot', 'controls', 'text', 'findings', 'clipboard'])

function newestRun() {
  const root = path.win32.join(SCRATCH_ROOT, 'monkey')
  if (!fs.existsSync(root)) return null
  const runs = fs
    .readdirSync(root)
    .map((name) => path.join(root, name, 'drive.json'))
    .filter((file) => fs.existsSync(file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return runs[0] ?? null
}

function parseValue(raw) {
  if (raw === 'true' || raw === 'false') return raw === 'true'
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  if (/^[[{]/.test(raw)) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  return raw
}

function main() {
  const args = process.argv.slice(2)
  let port = null
  let runFolder = null
  const rest = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--port') port = Number(args[(index += 1)])
    else if (args[index] === '--run') runFolder = args[(index += 1)]
    else rest.push(args[index])
  }
  const [command = '', ...pairs] = rest
  if (command === '--help' || command === '-h') {
    process.stdout.write(
      [
        'Usage: node scripts/monkey-drive.cjs <command> [key=value ...] [--port <n>] [--run <folder>]',
        'With no command it prints the list of commands from the running monkey.',
        ''
      ].join('\n')
    )
    return Promise.resolve(0)
  }
  if (!port) {
    const file = runFolder ? path.join(runFolder, 'drive.json') : newestRun()
    if (!file || !fs.existsSync(file)) {
      throw new Error('No monkey is running in drive mode. Start one with: npm run monkey -- drive')
    }
    port = Number(new URL(JSON.parse(fs.readFileSync(file, 'utf8')).url).port)
  }
  const body = {}
  for (const pair of pairs) {
    const at = pair.indexOf('=')
    if (at < 1) throw new Error(`Expected key=value, got ${JSON.stringify(pair)}`)
    const keys = pair.slice(0, at).split('.')
    let target = body
    for (const key of keys.slice(0, -1)) target = target[key] = target[key] ?? {}
    target[keys[keys.length - 1]] = parseValue(pair.slice(at + 1))
  }
  const [route, query = ''] = command.split('?')
  const method = GETS.has(route) ? 'GET' : 'POST'
  const payload = method === 'POST' ? JSON.stringify(body) : undefined
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: `/${route}${query ? `?${query}` : ''}`,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {}
      },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => (text += chunk))
        response.on('end', () => {
          process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
          resolve(response.statusCode && response.statusCode < 300 ? 0 : 1)
        })
      }
    )
    request.on('error', reject)
    request.setTimeout(15 * 60_000, () => request.destroy(new Error('No answer within 15 minutes')))
    if (payload) request.write(payload)
    request.end()
  })
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    process.stderr.write(`monkey-drive: ${error.message}\n`)
    process.exitCode = 1
  })
