/*
 * The quick check for the files you changed: `npm run check:changed`.
 *
 * `npm run verify` is the whole quality gate and prints everything. This is the
 * one to run while working: it formats the changed files, then lints them,
 * runs the project checks from `npm run lint`, typechecks, and runs only the
 * tests that import a changed file, all at once. It prints one line per step
 * and only what failed, so a check costs one short command instead of five
 * long ones.
 *
 *   npm run check:changed                     files changed since the last commit, and new files
 *   npm run check:changed -- --base master    files this branch changed since master
 *   npm run check:changed -- --no-tests       skip the tests
 *   npm run check:changed -- src/a.ts b.tsx   these files instead
 *
 * The steps read package.json, so `lint` and `typecheck` stay the one
 * definition of those checks. The typecheck is incremental (its build info is
 * kept in node_modules/.cache/check-changed), so a second run takes seconds.
 *
 * better-sqlite3 is built for Electron after `npm run dev` and for Node for the
 * tests. When a test fails because the build is the wrong one, this rebuilds it
 * for Node, runs the tests again, and rebuilds it for Electron at the end, like
 * `npm run verify`.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { parseArgs } = require('./lib/args.cjs')
const { projectRoot: root } = require('./lib/root.cjs')
const { npmCommand } = require('./lib/run.cjs')

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const bin = {
  prettier: path.join(root, 'node_modules/prettier/bin/prettier.cjs'),
  eslint: path.join(root, 'node_modules/eslint/bin/eslint.js'),
  tsc: path.join(root, 'node_modules/typescript/bin/tsc'),
  vitest: path.join(root, 'node_modules/vitest/vitest.mjs')
}
const cacheDir = path.join(root, 'node_modules/.cache/check-changed')
const CODE = /\.(ts|tsx|js|jsx|cjs|mjs)$/
const MAX_LINES = 40 // of one step's failures; the rest is counted, not printed
// Needs a packaged build (`npm run test:startup`), not a quick check.
const NOT_QUICK = ['tests/integration/startup-smoke.test.ts']

const args = parseArgs(process.argv.slice(2), { values: ['--base'] })
const base = args.value('--base') ?? 'HEAD'
const withTests = !args.has('--no-tests')
// Files named on the command line are checked instead of the changed ones.
const named = args.positionals

// Colour codes some tools print even with NO_COLOR.
// eslint-disable-next-line no-control-regex
const ansi = /\x1b\[[0-9;]*m/g
const clean = (text) => text.replace(ansi, '').replace(/\r/g, '')

// Captured, never inherited: only what failed is printed.
function capture(command, argv, shell) {
  return new Promise((resolve) => {
    const child = spawn(command, argv, {
      cwd: root,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      shell
    })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('error', (error) => resolve({ code: 1, out: String(error) }))
    child.on('close', (code) => resolve({ code: code ?? 1, out: clean(out) }))
  })
}

/** A Node script file, run with this Node. */
const run = (file, argv) => capture(process.execPath, [file, ...argv], false)

function runNpm(script) {
  const npm = npmCommand(['run', script])
  return capture(npm.command, npm.args, npm.shell)
}

function git(...argv) {
  const r = spawnSync('git', argv, { cwd: root, encoding: 'utf8' })
  return r.status === 0
    ? r.stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
}

function changedFiles() {
  if (named.length)
    return named.map((f) => path.relative(root, path.resolve(f)).replace(/\\/g, '/'))
  const files = new Set([
    ...git('diff', '--name-only', '--diff-filter=d', base),
    ...git('ls-files', '--others', '--exclude-standard')
  ])
  return [...files].filter((f) => fs.existsSync(path.join(root, f))).sort()
}

const head = (lines, n = MAX_LINES) =>
  lines.length > n ? [...lines.slice(0, n), `... ${lines.length - n} more lines`] : lines

// One step's verdict: ok, a short detail, and the lines worth reading when it failed.
const result = (ok, detail, lines = []) => ({ ok, detail, lines: ok ? [] : head(lines) })

async function prettier(files) {
  if (files.length === 0) return result(true, 'no files')
  const r = await run(bin.prettier, ['--write', '--list-different', '--ignore-unknown', ...files])
  const lines = r.out.split('\n').filter(Boolean)
  const formatted = lines.filter((l) => files.includes(l.trim()))
  const problems = lines.filter((l) => !files.includes(l.trim()))
  if (r.code !== 0 && problems.length > 0) return result(false, 'could not format', problems)
  return result(
    true,
    formatted.length
      ? `reformatted ${formatted.join(', ')}`
      : `${files.length} files already formatted`
  )
}

async function eslint(files) {
  const code = files.filter((f) => CODE.test(f))
  if (code.length === 0) return result(true, 'no code files')
  const r = await run(bin.eslint, ['--format', 'json', '--no-warn-ignored', ...code])
  let report
  try {
    report = JSON.parse(r.out.slice(r.out.indexOf('[')))
  } catch {
    return result(false, 'did not run', r.out.split('\n'))
  }
  const lines = report.flatMap((f) =>
    f.messages.map(
      (m) =>
        `${path.relative(root, f.filePath).replace(/\\/g, '/')}:${m.line}:${m.column} ` +
        `${m.severity === 2 ? 'error' : 'warning'} ${m.message} (${m.ruleId ?? 'parse'})`
    )
  )
  const errors = report.reduce((n, f) => n + f.errorCount, 0)
  return errors === 0
    ? result(true, `${code.length} files${lines.length ? `, ${lines.length} warnings` : ''}`)
    : result(false, `${errors} errors`, lines)
}

// The `npm run lint` steps other than eslint (which ran on the changed files above).
async function projectChecks() {
  const steps = pkg.scripts.lint
    .split('&&')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('node '))
  const results = await Promise.all(
    steps.map((s) => run(s.split(/\s+/)[1], s.split(/\s+/).slice(2)))
  )
  const failed = results.flatMap((r, i) =>
    r.code === 0 ? [] : [`$ ${steps[i]}`, ...r.out.split('\n').filter(Boolean)]
  )
  return failed.length ? result(false, 'failed', failed) : result(true, `${steps.length} checks`)
}

// Each `tsc --noEmit -p X` of `npm run typecheck`, incremental.
async function typecheck() {
  fs.mkdirSync(cacheDir, { recursive: true })
  const projects = [...pkg.scripts.typecheck.matchAll(/-p\s+(\S+)/g)].map((m) => m[1])
  const results = await Promise.all(
    projects.map((p) =>
      run(bin.tsc, [
        '--noEmit',
        '-p',
        p,
        '--incremental',
        '--tsBuildInfoFile',
        path.join(cacheDir, `${p}.tsbuildinfo`)
      ])
    )
  )
  const errors = [
    ...new Set(results.flatMap((r) => r.out.split('\n').filter((l) => /error TS\d+/.test(l))))
  ]
  const broke = results.some((r) => r.code !== 0)
  if (!broke) return result(true, `${projects.length} projects`)
  return result(
    false,
    `${errors.length} errors`,
    errors.length
      ? errors
      : results
          .map((r) => r.out)
          .join('\n')
          .split('\n')
  )
}

async function vitestRelated(files) {
  const report = path.join(os.tmpdir(), `check-changed-${process.pid}.json`)
  const argv = [
    'related',
    ...files,
    '--run',
    '--silent',
    '--passWithNoTests',
    '--reporter=json',
    `--outputFile=${report}`
  ]
  for (const f of NOT_QUICK) argv.push('--exclude', f)
  const r = await run(bin.vitest, argv)
  let json = null
  try {
    json = JSON.parse(fs.readFileSync(report, 'utf8'))
    fs.rmSync(report, { force: true })
  } catch {
    // No report: vitest failed before writing one, and its output says why.
  }
  return { r, json }
}

const wrongBuild = (text) =>
  /NODE_MODULE_VERSION|compiled against a different Node\.js version/.test(text)

async function tests(files) {
  const code = files.filter((f) => CODE.test(f))
  if (code.length === 0) return result(true, 'no code files')
  let { r, json } = await vitestRelated(code)
  let rebuilt = false
  if (r.code !== 0 && wrongBuild(r.out + JSON.stringify(json ?? ''))) {
    const rebuild = await runNpm('rebuild:test')
    if (rebuild.code !== 0)
      return result(
        false,
        'could not rebuild better-sqlite3 for the tests',
        rebuild.out.split('\n')
      )
    rebuilt = true
    ;({ r, json } = await vitestRelated(code))
  }
  if (rebuilt) {
    const back = await runNpm('rebuild:native')
    if (back.code !== 0)
      process.stderr.write('check:changed: run `npm run rebuild:native` before `npm run dev`.\n')
  }
  if (!json)
    return result(
      r.code === 0,
      r.code === 0 ? 'no related tests' : 'did not run',
      r.out.split('\n')
    )
  if (json.numTotalTestSuites === 0 && json.numTotalTests === 0)
    return result(true, 'no related tests')
  const where = (f) => path.relative(root, f).replace(/\\/g, '/')
  const lines = []
  for (const file of json.testResults) {
    if (file.status !== 'failed') continue
    const failed = file.assertionResults.filter((a) => a.status === 'failed')
    if (failed.length === 0)
      lines.push(`${where(file.name)}: ${(file.message || 'failed to run').split('\n')[0]}`)
    for (const a of failed) {
      lines.push(`${where(file.name)} > ${a.fullName}`)
      const message = (a.failureMessages[0] || '')
        .split('\n')
        .filter((l) => l.trim() && !/^\s+at /.test(l))
      lines.push(...message.slice(0, 6).map((l) => `    ${l}`))
    }
  }
  const summary = `${json.numPassedTests}/${json.numTotalTests} tests in ${json.testResults.length} files`
  return r.code === 0 && json.success !== false
    ? result(true, summary)
    : result(false, summary, lines)
}

// Files that mean a new feature or a new kind of data. When a change touches
// one and no demo file, the check reminds you to decide whether the demos
// should show it. A reminder only: it never fails the check, because many such
// changes (a bug fix, a rename) have nothing to show.
const FEATURE_FILES = [
  /^electron\/services\/database\/migrations\//,
  /^src\/shared\/ostler-api\/(project|template)-types\.ts$/,
  /^electron\/services\/project-package-service\.ts$/,
  /^src\/renderer\/navigation\/registry\.ts$/
]
const DEMO_FILES = /^src\/shared\/templates\/(sample|demo-advanced)\.json$/

function demoReminder(files) {
  const touched = files.filter((f) => FEATURE_FILES.some((re) => re.test(f)))
  if (touched.length === 0 || files.some((f) => DEMO_FILES.test(f))) return []
  return [
    `demos: ${touched.join(', ')} changed but neither demo did.`,
    'If this adds a feature or kind of data a new person would want to see, add it to',
    'src/shared/templates/sample.json and/or demo-advanced.json (CONTRIBUTING.md, "Demo projects");',
    'if not, the demos do not need it.'
  ]
}

async function main() {
  const startedAt = Date.now()
  const files = changedFiles().filter((f) => fs.existsSync(path.join(root, f)))
  if (files.length === 0) {
    process.stdout.write(`check:changed: nothing changed since ${base}\n`)
    return
  }
  process.stdout.write(
    `check:changed: ${files.length} ${named.length ? 'named' : `changed since ${base}:`} files\n`
  )
  // Formatting first: it rewrites files the other steps then read.
  const steps = [['prettier', await prettier(files)]]
  const rest = [
    ['eslint', eslint(files)],
    ['lint checks', projectChecks()],
    ['typecheck', typecheck()]
  ]
  if (withTests) rest.push(['tests', tests(files)])
  for (const [name, pending] of rest) steps.push([name, await pending])

  for (const [name, r] of steps) {
    process.stdout.write(`  ${r.ok ? 'ok  ' : 'FAIL'} ${name.padEnd(12)} ${r.detail}\n`)
    for (const line of r.lines) process.stdout.write(`       ${line}\n`)
  }
  for (const line of demoReminder(files))
    process.stdout.write(`  note ${line}
`)
  const failed = steps.filter(([, r]) => !r.ok).map(([name]) => name)
  const seconds = Math.round((Date.now() - startedAt) / 1000)
  if (failed.length) {
    process.stdout.write(`check:changed: FAILED (${failed.join(', ')}) in ${seconds}s\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(
      `check:changed: all passed in ${seconds}s${withTests ? '' : ' (tests skipped)'}\n`
    )
  }
}

main().catch((error) => {
  process.stderr.write(`check:changed: ${error.stack || error}\n`)
  process.exitCode = 1
})
