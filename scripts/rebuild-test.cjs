const fs = require('node:fs')
const path = require('node:path')

const nativeBindingPath = path.join(
  __dirname,
  '..',
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
)

if (process.platform === 'win32' && fs.existsSync(nativeBindingPath)) {
  let descriptor
  try {
    descriptor = fs.openSync(nativeBindingPath, 'r+')
  } catch (error) {
    if (error && ['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) {
      process.stderr.write(
        `Cannot rebuild better-sqlite3 because its native binding is in use:\n${nativeBindingPath}\n\n` +
          'Stop npm run dev (and any other Electron process using this checkout), then run the test command again. ' +
          'A separate checkout or build output is also safe.\n'
      )
      process.exit(1)
    }
    throw error
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}
