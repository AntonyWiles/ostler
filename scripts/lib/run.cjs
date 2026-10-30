/*
 * Starting npm from a script. Under `npm run`, npm gives its own CLI file in
 * npm_execpath; running that with Node avoids spawning npm.cmd through a shell
 * on Windows. Run directly, the npm bundled beside node is used the same way.
 * Only when neither exists is `npm` started through a shell on Windows.
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

/** How to start npm with these arguments: { command, args, shell }. */
function npmCommand(args) {
  const bundled = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  const cli = process.env.npm_execpath || (fs.existsSync(bundled) ? bundled : null)
  return cli
    ? { command: process.execPath, args: [cli, ...args], shell: false }
    : { command: 'npm', args, shell: process.platform === 'win32' }
}

/** spawnSync for npm with these arguments; `options` as for spawnSync (shell is set here). */
function runNpm(args, options = {}) {
  const npm = npmCommand(args)
  return spawnSync(npm.command, npm.args, { ...options, shell: npm.shell })
}

module.exports = { npmCommand, runNpm }
