/*
 * `npm run monkey -- [journey|explore|drive|report] [options]`: uses Ostler
 * through its window like a person would, records every action, key and
 * screen, and writes a report of what it found. tests/monkey/README.md has
 * the details; `npm run monkey -- --help` lists the options.
 *
 * The flags become MONKEY_* environment variables for tests/monkey (read in
 * tests/monkey/lib/options.ts, where the defaults live), and the run itself
 * goes through Playwright with config/playwright.monkey.config.ts.
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const HELP = `Usage: npm run monkey -- [mode] [options]

Modes
  journey   (default) carry the dummy project, Pomodoro Desk, from first run to finished milestones
  explore   a seeded random walk through every screen, pressing what nobody pressed yet
  whiteboard  every whiteboard tool, drag, style, dialog and template, then a seeded random spell
            on a board, with a burst of screenshots after every action and mid-drag shots
  drive     open Ostler and take commands over HTTP, for an AI overseer or a person with curl
  report    rewrite report.md and report.html for an existing run folder: npm run monkey -- report <folder>

Options
  --ai off|fake|live          Ostler AI: none, the built-in stand-in (default), or a real provider
  --ai-preset <id>            live AI: the setup's provider (default anthropic)
  --ai-model <id>             live AI: the model to choose, e.g. a Claude Haiku model id
                              The key is read from the MONKEY_AI_KEY environment variable, never a flag.
  --agents off|simulated|embedded|external
                              who does the coding: nobody, the monkey over the harness API (default),
                              Ostler's built-in agents, or an external agent you start yourself
  --phases a,b,c              journey: only these phases (see tests/monkey/journeys/dummy-app.ts)
  --run <folder>              continue an earlier run: same data, same project, new session
  --seed <n>                  explore: replay a walk
  --steps <n>                 explore: at most this many actions (default 300)
  --minutes <n>               explore and agent waits: at most this long
  --speed instant|brisk|human typing and thinking delays (default brisk)
  --shots all|phases|errors   screenshot after every action (default), per phase, or on findings only
  --a11y                      run the axe accessibility check on every new screen
  --keep-open                 after a journey or exploration, stay open in drive mode
  --port <n>                  drive mode's port (default: any free one)
  --viewport 1440x900         window size
  --on-screen                 show the window where you can see it; by default it opens off-screen
                              and never takes focus, so a run does not get in the way of your work
  --build                     run npm run build and rebuild:native first

Runs live in C:\\temp\\ostler-roadmap\\monkey\\<run> (on Linux, $TMPDIR/ostler-roadmap/monkey/<run>),
never in your real Ostler data folder.`

const FLAGS = {
  '--ai': 'MONKEY_AI',
  '--ai-preset': 'MONKEY_AI_PRESET',
  '--ai-model': 'MONKEY_AI_MODEL',
  '--agents': 'MONKEY_AGENTS',
  '--phases': 'MONKEY_PHASES',
  '--run': 'MONKEY_RUN_DIR',
  '--seed': 'MONKEY_SEED',
  '--steps': 'MONKEY_STEPS',
  '--minutes': 'MONKEY_MINUTES',
  '--speed': 'MONKEY_SPEED',
  '--shots': 'MONKEY_SHOTS',
  '--port': 'MONKEY_DRIVE_PORT',
  '--viewport': 'MONKEY_VIEWPORT'
}
const SWITCHES = {
  '--a11y': 'MONKEY_A11Y',
  '--keep-open': 'MONKEY_KEEP_OPEN',
  '--on-screen': 'MONKEY_ON_SCREEN'
}
const MODES = ['journey', 'explore', 'whiteboard', 'drive', 'report']

function run(command, args, env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: false })
  if (result.error) throw result.error
  return result.status ?? 1
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${HELP}\n`)
    return 0
  }
  const env = { ...process.env }
  let mode = 'journey'
  let build = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (MODES.includes(arg)) {
      mode = arg
      if (arg === 'report' && args[index + 1] && !args[index + 1].startsWith('--')) {
        env.MONKEY_RUN_DIR = path.resolve(args[(index += 1)])
      }
    } else if (arg === '--build') build = true
    else if (SWITCHES[arg]) env[SWITCHES[arg]] = '1'
    else if (FLAGS[arg]) {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`)
      env[FLAGS[arg]] = arg === '--run' ? path.resolve(value) : value
      index += 1
    } else throw new Error(`Unknown option ${arg}. npm run monkey -- --help lists them.`)
  }
  env.MONKEY_MODE = mode
  if (mode === 'report' && !env.MONKEY_RUN_DIR) throw new Error('report needs a run folder')
  if (env.MONKEY_RUN_DIR && !fs.existsSync(env.MONKEY_RUN_DIR)) {
    throw new Error(`No run folder at ${env.MONKEY_RUN_DIR}`)
  }
  // Your own API key must never reach a monkey's app by accident.
  delete env.OSTLER_AI_API_KEY

  const root = path.resolve(__dirname, '..')
  const npmCli = process.env.npm_execpath
  if (build) {
    for (const script of ['build', 'rebuild:native']) {
      const status = npmCli
        ? run(process.execPath, [npmCli, 'run', script], env)
        : run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], env)
      if (status !== 0) return status
    }
  } else if (
    mode !== 'report' &&
    !fs.existsSync(path.join(root, 'out', 'renderer', 'index.html'))
  ) {
    throw new Error(
      'Ostler is not built (out/renderer is missing). Add --build, or run npm run build first.'
    )
  }
  return run(
    process.execPath,
    [
      require.resolve('@playwright/test/cli'),
      'test',
      '-c',
      path.join(root, 'config', 'playwright.monkey.config.ts')
    ],
    env
  )
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write(`monkey: ${error.message}\n`)
  process.exitCode = 1
}
