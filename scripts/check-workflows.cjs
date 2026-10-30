/*
 * Fails when .github/workflows holds anything but the allowed workflows.
 * Nothing runs on GitHub beyond the release (CONTRIBUTING.md, "No GitHub
 * workflows"): tests run locally, on Windows or with scripts/linux-test.sh,
 * never as a CI job. Adding a workflow means changing ALLOWED here.
 */
const fs = require('node:fs')
const path = require('node:path')
const { projectRoot } = require('./lib/root.cjs')

const ALLOWED = ['release.yml']

const directory = path.join(projectRoot, '.github', 'workflows')
const found = fs.existsSync(directory) ? fs.readdirSync(directory) : []
const extra = found.filter((name) => !ALLOWED.includes(name))

if (extra.length > 0) {
  process.stderr.write(
    `GitHub workflows that are not allowed: ${extra.join(', ')}\n` +
      'Nothing may run on GitHub except release.yml. Remove these files (CONTRIBUTING.md, "No GitHub workflows").\n'
  )
  process.exitCode = 1
}
