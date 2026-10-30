/*
 * Prints the release notes for one version: its section of CHANGELOG.md, the
 * same text the app shows under Help › What's new (P10.1). The release
 * workflow writes this into the draft GitHub release's body.
 *
 *   node scripts/release-notes.cjs 1.0.0       # the [1.0.0] section
 *   node scripts/release-notes.cjs v1.0.0      # the same; a tag's "v" is dropped
 *   node scripts/release-notes.cjs Unreleased  # what the next release will say
 *
 * Fails, with the reason on stderr, when the version has no section or an
 * empty one: a release must not go out without its notes.
 */
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const { projectRoot } = require('./lib/root.cjs')

/** Loads src/shared/changelog.ts, the parser the app uses: it has no imports, so transpiling it is enough. */
function loadParser() {
  const source = fs.readFileSync(path.join(projectRoot, 'src', 'shared', 'changelog.ts'), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  })
  const module = { exports: {} }
  new Function('module', 'exports', outputText)(module, module.exports)
  return module.exports
}

/** The notes for `version` in `changelog`, or throws an Error that says what to fix. */
function releaseNotes(changelog, version) {
  const name = String(version || '').replace(/^v(?=\d)/, '')
  if (!name) throw new Error('Name a version: node scripts/release-notes.cjs 1.0.0')
  const notes = loadParser().changelogVersionNotes(changelog, name)
  if (notes) return notes
  throw new Error(
    name.toLowerCase() === 'unreleased'
      ? 'CHANGELOG.md has nothing under [Unreleased].'
      : `CHANGELOG.md has no notes for ${name}. Move the Unreleased notes under "## [${name}] - <date>" first (docs/releasing.md).`
  )
}

function main(argv) {
  const changelog = fs.readFileSync(path.join(projectRoot, 'CHANGELOG.md'), 'utf8')
  try {
    process.stdout.write(`${releaseNotes(changelog, argv[2])}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`release-notes: ${error.message}\n`)
    return 1
  }
}

if (require.main === module) process.exitCode = main(process.argv)

module.exports = { releaseNotes }
