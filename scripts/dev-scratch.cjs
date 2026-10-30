/*
 * `npm run dev:scratch -- <name> [--fresh]`: runs exactly what `npm run dev`
 * runs, against the scratch data folder C:\temp\ostler-roadmap\<name>, so
 * development never touches your real data. A new scratch folder gets a
 * minimal config.json that moves the harness and automation ports off the
 * defaults. `--fresh` deletes the folder first, and only ever inside
 * the scratch root.
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { SCRATCH_CONFIG, scratchDataDir, assertDeletable } = require('./scratch-paths.cjs')

function main() {
  const args = process.argv.slice(2)
  const fresh = args.includes('--fresh')
  const names = args.filter((arg) => arg !== '--fresh')
  if (names.length !== 1) {
    process.stderr.write('Usage: npm run dev:scratch -- <name> [--fresh]\n')
    return 1
  }
  const dataDirectory = scratchDataDir(names[0])

  if (fresh && fs.existsSync(dataDirectory)) {
    fs.rmSync(assertDeletable(dataDirectory), { recursive: true, force: true })
    process.stdout.write(`dev:scratch: deleted ${dataDirectory}\n`)
  }

  const configPath = path.join(dataDirectory, 'config.json')
  fs.mkdirSync(dataDirectory, { recursive: true })
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, `${JSON.stringify(SCRATCH_CONFIG, null, 2)}\n`)
    process.stdout.write(`dev:scratch: wrote ${configPath}\n`)
  }

  process.stdout.write(`dev:scratch: OSTLER_USER_DATA=${dataDirectory}\n`)
  const result = spawnSync(process.execPath, [path.join(__dirname, 'dev.cjs')], {
    stdio: 'inherit',
    env: { ...process.env, OSTLER_USER_DATA: dataDirectory }
  })
  if (result.error) process.stderr.write(`${result.error.stack || result.error}\n`)
  return result.status ?? 1
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write(`dev:scratch: ${error.message}\n`)
  process.exitCode = 1
}
