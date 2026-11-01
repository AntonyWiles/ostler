#!/usr/bin/env node
/**
 * The two steps of an Android release (docs/mobile/releasing.md, "Build the bundle").
 *
 *   npm run release:android -- --bump  raise versionCode by one and the patch version; commit it
 *   npm run release:android            build the signed Play bundle from a clean, short checkout
 *
 * The build refuses a checkout whose path is long, because CMake fails on Windows past 260
 * characters, and a mapped drive (`subst`) does not help: Node resolves it back to the long path
 * and Gradle then refuses to mix the two. It also refuses uncommitted changes, so every bundle
 * matches a commit, and a bundle signed with the debug key, which Play refuses.
 */
const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const mobile = path.resolve(__dirname, '..')
const repo = path.dirname(mobile)
const configPath = path.join(mobile, 'app.config.ts')
const windows = process.platform === 'win32'
// `C:\o\rel` is 8 characters; the native build's deepest paths add about 240.
const MAX_REPO_PATH = 16

function fail(message) {
  console.error(`release: ${message}`)
  process.exit(1)
}

// The dev variant (app.config.ts) is a separate test app with its own package; Play never gets it.
if (process.env.OSTLER_ANDROID_VARIANT) {
  fail('OSTLER_ANDROID_VARIANT is set; unset it, a release is always the real app')
}

function readVersion() {
  const text = fs.readFileSync(configPath, 'utf8')
  const version = /^\s*version: '(\d+)\.(\d+)\.(\d+)',$/m.exec(text)
  const code = /^\s*versionCode: (\d+),$/m.exec(text)
  if (!version || !code) fail('app.config.ts no longer has the expected version lines')
  return { text, version: version.slice(1).map(Number), code: Number(code[1]) }
}

function bump() {
  const current = readVersion()
  const [major, minor, patch] = current.version
  const version = `${major}.${minor}.${patch + 1}`
  const code = current.code + 1
  const text = current.text
    .replace(/^(\s*version: )'[\d.]+',$/m, `$1'${version}',`)
    .replace(/^(\s*versionCode: )\d+,$/m, `$1${code},`)
  fs.writeFileSync(configPath, text)
  console.log(`release: version ${version}, versionCode ${code}`)
  console.log(
    'release: add the changes to CHANGELOG.md, commit, then build from the short checkout'
  )
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: windows })
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed`)
}

function git(...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
}

if (process.argv.includes('--bump')) {
  bump()
  process.exit(0)
}

if (windows && repo.length > MAX_REPO_PATH) {
  fail(
    `${repo} is too long a path for the native build. Build from a short checkout instead, ` +
      'for example: git worktree add --detach C:\\o\\rel main, then npm install and ' +
      'npm run release:android in its mobile folder.'
  )
}
if (git('status', '--porcelain') !== '') {
  fail('the checkout has uncommitted changes: build only what is committed')
}

const { version, code } = readVersion()
const commit = git('rev-parse', '--short', 'HEAD')

// Generates mobile/android/ (ignored) and applies the release signing from app.config.ts.
run('npx', ['expo', 'prebuild', '--platform', 'android'], mobile)
const android = path.join(mobile, 'android')
// One worker: the native modules' CMake builds fail on Windows when Gradle runs them in parallel.
run(
  path.join(android, windows ? 'gradlew.bat' : 'gradlew'),
  ['bundleRelease', '--max-workers=1'],
  android
)

const bundle = path.join(android, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab')
if (!fs.existsSync(bundle)) fail(`no bundle at ${bundle}`)
const cert = execFileSync('keytool', ['-printcert', '-jarfile', bundle], { encoding: 'utf8' })
if (/CN=Android Debug/.test(cert)) {
  fail('the bundle is signed with the debug key: set the OSTLER_UPLOAD_* Gradle properties')
}
const sha1 = /SHA1: ([0-9A-F:]+)/.exec(cert)
console.log(
  `release: ${version} (${code}) from commit ${commit}, signed by ${sha1 ? sha1[1] : 'an unknown key'}`
)
console.log(`release: ${bundle}`)
