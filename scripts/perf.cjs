/*
 * `npm run perf` (P9.1): builds Ostler, makes sure better-sqlite3 is built for
 * Electron, seeds the scale dataset if C:\temp\ostler-roadmap\p9-1-scale does
 * not exist yet, then runs the performance suite (tests/perf/), which writes
 * test-results/perf.json and fails when a budget is missed.
 *
 * OSTLER_PERF_DATA points the suite at another seeded folder;
 * OSTLER_PERF_IDLE_MINUTES shortens the idle measurement (the budget is 10).
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { scratchDataDir } = require('./scratch-paths.cjs')

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: true, env })
  return result.status ?? 1
}

function main() {
  if (run('npx', ['electron-vite', 'build']) !== 0) return 1
  if (run('npm', ['run', 'rebuild:native']) !== 0) return 1
  const data = process.env.OSTLER_PERF_DATA || scratchDataDir('p9-1-scale')
  if (!fs.existsSync(path.join(data, 'ostler.db'))) {
    if (process.env.OSTLER_PERF_DATA) {
      process.stderr.write(`perf: no dataset at ${data}\n`)
      return 1
    }
    if (run('node', [path.join(__dirname, 'seed-scale.cjs'), 'p9-1-scale', '--no-build']) !== 0)
      return 1
  }
  return run(
    'npx',
    ['playwright', 'test', '-c', 'playwright.perf.config.ts', ...process.argv.slice(2)],
    {
      ...process.env,
      OSTLER_PERF_DATA: data
    }
  )
}

process.exitCode = main()
