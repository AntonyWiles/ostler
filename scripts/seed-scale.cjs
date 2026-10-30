/*
 * `npm run seed:scale -- <scratch-name>` (P9.1): builds Ostler, then runs it in
 * its development-only seeding mode against the scratch data folder
 * C:\temp\ostler-roadmap\<scratch-name>, which must not exist yet (or pass
 * `--fresh` to delete it first, only ever inside the scratch root). The five
 * scratch Git folders go in C:\temp\ostler-roadmap\projects\<scratch-name>.
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const {
  SCRATCH_CONFIG,
  scratchDataDir,
  scratchProjectDir,
  assertDeletable
} = require('./scratch-paths.cjs')
const { parseArgs } = require('./lib/args.cjs')
const { projectRoot } = require('./lib/root.cjs')

function run(command, args, env) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: true, env })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`)
}

function main() {
  const args = parseArgs()
  const fresh = args.has('--fresh')
  const skipBuild = args.has('--no-build')
  const names = args.positionals
  if (names.length !== 1) {
    process.stderr.write('Usage: npm run seed:scale -- <scratch-name> [--fresh] [--no-build]\n')
    return 1
  }
  const dataDirectory = scratchDataDir(names[0])
  const projectsParent = scratchProjectDir(names[0])
  for (const folder of [dataDirectory, projectsParent]) {
    if (!fs.existsSync(folder)) continue
    if (!fresh) {
      process.stderr.write(`seed:scale: ${folder} exists; pass --fresh to replace it\n`)
      return 1
    }
    fs.rmSync(assertDeletable(folder), { recursive: true, force: true })
  }
  fs.mkdirSync(dataDirectory, { recursive: true })
  fs.mkdirSync(projectsParent, { recursive: true })
  // Past the welcome and this version's What's new, agents off, ports off
  // the defaults.
  const { version } = require('../package.json')
  const config = { ...SCRATCH_CONFIG, ui: { firstRunCompleted: true, lastSeenVersion: version } }
  fs.writeFileSync(path.join(dataDirectory, 'config.json'), `${JSON.stringify(config, null, 2)}\n`)

  if (!skipBuild) run('npx', ['electron-vite', 'build'], process.env)
  const electron = require('electron')
  const env = { ...process.env, OSTLER_USER_DATA: dataDirectory, OSTLER_SEED_SCALE: projectsParent }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(electron, [projectRoot], { stdio: 'inherit', env })
  if (result.status !== 0) {
    process.stderr.write('seed:scale: seeding failed\n')
    return result.status ?? 1
  }
  process.stdout.write(`seed:scale: done. OSTLER_USER_DATA=${dataDirectory}\n`)
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write(`seed:scale: ${error.message}\n`)
  process.exitCode = 1
}
