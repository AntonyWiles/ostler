/*
 * `npm run scratch:project -- <name>`: creates C:\temp\ostler-roadmap\projects\<name>
 * as a Git repository with a README and one commit, for testing folder and
 * agent features without touching a real project. Refuses an existing
 * non-empty folder.
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { scratchProjectDir } = require('./scratch-paths.cjs')

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.error}`)
  }
}

function main() {
  const args = process.argv.slice(2)
  if (args.length !== 1) {
    process.stderr.write('Usage: npm run scratch:project -- <name>\n')
    return 1
  }
  const name = args[0]
  const directory = scratchProjectDir(name)
  if (fs.existsSync(directory) && fs.readdirSync(directory).length > 0) {
    throw new Error(`${directory} already exists and is not empty`)
  }
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(
    path.join(directory, 'README.md'),
    `# ${name}\n\nA scratch project for testing Ostler. Safe to delete.\n`
  )
  git(directory, ['init', '--quiet', '--initial-branch=main'])
  git(directory, ['add', 'README.md'])
  git(directory, [
    '-c',
    'user.name=Ostler Scratch',
    '-c',
    'user.email=scratch@ostler.invalid',
    'commit',
    '--quiet',
    '--no-gpg-sign',
    '-m',
    'Initial commit'
  ])
  process.stdout.write(`scratch:project: created ${directory}\n`)
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write(`scratch:project: ${error.message}\n`)
  process.exitCode = 1
}
