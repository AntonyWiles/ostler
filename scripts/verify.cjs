/*
 * The whole quality gate in one command: `npm run verify`.
 *
 * Runs each check through its own npm script, so the scripts in package.json
 * stay the one definition of what a check is. Stops at the first failure.
 *
 * better-sqlite3 is a native module built for one ABI at a time: Electron's for
 * `npm run dev`, Node's for Vitest. The test scripts rebuild it for Node, so
 * this always rebuilds it for Electron at the end, even when a step failed,
 * and `npm run dev` works straight afterwards.
 *
 * CI splits the gate into parallel jobs (.github/workflows/ci.yml) with:
 *   --only <steps>        run just these steps, comma separated (typecheck, lint,
 *                         format:check, test, test:components, test:integration)
 *   --shard <i>/<n>       pass Vitest's --shard to the test steps that run
 *   --no-electron-rebuild skip the final rebuild for Electron (a CI runner never
 *                         starts the app)
 * With no flags it is the whole gate, as before.
 */
const { parseArgs } = require('./lib/args.cjs')
const { projectRoot } = require('./lib/root.cjs')
const { runNpm } = require('./lib/run.cjs')

const steps = ['typecheck', 'lint', 'format:check', 'test', 'test:components', 'test:integration']

const args = parseArgs(process.argv.slice(2), { values: ['--only', '--shard'] })
const only = args.value('--only')
const shard = args.value('--shard')
const rebuildForElectron = !args.has('--no-electron-rebuild')
const testSteps = new Set(['test', 'test:components', 'test:integration'])
const selected = only ? only.split(',').map((name) => name.trim()) : steps
const unknown = selected.filter((name) => !steps.includes(name))
if (unknown.length > 0) {
  process.stderr.write(
    `verify: unknown step ${unknown.join(', ')}; steps are ${steps.join(', ')}\n`
  )
  process.exit(2)
}
if (shard !== undefined && !/^\d+\/\d+$/.test(shard)) {
  process.stderr.write('verify: --shard needs the form i/n, for example 1/4\n')
  process.exit(2)
}

function runScript(script) {
  // Vitest's own flag goes after `--`, which npm hands to the last command in the script.
  const extra = shard && testSteps.has(script) ? ['--', `--shard=${shard}`] : []
  process.stdout.write(
    `\n> verify: npm run ${script}${extra.length ? ` ${extra.join(' ')}` : ''}\n`
  )
  const result = runNpm(['run', script, ...extra], { cwd: projectRoot, stdio: 'inherit' })
  if (result.error) process.stderr.write(`${result.error.stack || result.error}\n`)
  return result.status ?? 1
}

function main() {
  const startedAt = Date.now()
  let failed = null
  try {
    for (const step of selected) {
      if (runScript(step) !== 0) {
        failed = step
        break
      }
    }
  } finally {
    if (rebuildForElectron && runScript('rebuild:native') !== 0) {
      process.stderr.write(
        '\nverify: could not rebuild better-sqlite3 for Electron; run `npm run rebuild:native` before `npm run dev`.\n'
      )
      failed = failed ?? 'rebuild:native'
    }
  }
  const seconds = Math.round((Date.now() - startedAt) / 1000)
  if (failed) {
    process.stderr.write(`\nverify: FAILED at \`npm run ${failed}\` (${seconds}s)\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(`\nverify: all ${selected.length} checks passed (${seconds}s)\n`)
  }
}

main()
