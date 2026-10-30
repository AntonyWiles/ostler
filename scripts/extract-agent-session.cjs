/* Generic entry point retained separately from the legacy Codex-named command. */
'use strict'

const implementation = require('./extract-codex-session.cjs')

if (require.main === module) {
  try {
    implementation.main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = implementation
