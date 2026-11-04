#!/usr/bin/env node
/**
 * Builds "Ostler Dev" (the dev variant, `<package>.dev`) as a standalone APK with the JavaScript
 * inside, and installs it on a phone over adb (USB or wireless debugging), keeping the app's data.
 * It runs from whatever is in this working tree, committed or not, so a change can be tried on
 * the phone straight away. It never touches the Play app or its signing key.
 *
 *   node mobile/scripts/sideload-android.cjs --dir <short folder> [options]
 *
 *   --dir <folder>      Where the build happens (or OSTLER_SIDELOAD_DIR). Must be a short path such
 *                       as C:\o\dev: CMake fails on long Windows paths. It must be a `git worktree`
 *                       of this repository; the working tree is copied into it before each build.
 *   --device <serial>   The phone, as `adb devices` lists it (or ANDROID_SERIAL). Without it, the
 *                       only device connected is used, else a wireless-debugging phone found by
 *                       `adb mdns services` is connected.
 *   --clean             Run `expo prebuild --clean` even when nothing native changed.
 *   --build-only        Build the APK but don't install it.
 *   --install-only      Install the APK built last time.
 *   --setup-code <file> After installing, open the app's Advanced sync with the setup code in this
 *                       file filled in (the passphrase is still typed on the phone).
 *   --clear             Wipe Ostler Dev's data on the phone before installing (asks nothing).
 *   --r2-config <file>  Build the bucket in this JSON file (an R2 setup: config, space, checkMinutes)
 *                       into the app (or OSTLER_SIDELOAD_R2_CONFIG), so it syncs from its first start
 *                       with nothing to type. Keep the file outside the repository: it holds the key.
 *
 * Gradle runs with the settings that kept a many-core Windows PC from running out of memory
 * (one worker, arm64 only, in-process Kotlin); OSTLER_SIDELOAD_GRADLE_ARGS adds more.
 */
const { spawnSync, execFileSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const mobile = path.resolve(__dirname, '..')
const repo = path.dirname(mobile)
const windows = process.platform === 'win32'
const PACKAGE_SUFFIX = '.dev'
const MAX_DIR_LENGTH = 16

function fail(message) {
  console.error(`sideload: ${message}`)
  process.exit(1)
}

function say(message) {
  console.log(`sideload: ${message}`)
}

function args() {
  const given = process.argv.slice(2)
  const options = { flags: new Set() }
  for (let i = 0; i < given.length; i++) {
    const arg = given[i]
    if (['--dir', '--device', '--setup-code', '--r2-config'].includes(arg)) {
      options[arg.slice(2)] = given[++i]
      if (!options[arg.slice(2)]) fail(`${arg} needs a value`)
    } else if (['--clean', '--build-only', '--install-only', '--clear'].includes(arg)) {
      options.flags.add(arg.slice(2))
    } else {
      fail(`unknown option ${arg}`)
    }
  }
  return options
}

function run(command, commandArgs, cwd, env = process.env) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit', shell: windows, env })
  if (result.status !== 0) fail(`${command} ${commandArgs.join(' ')} failed`)
}

function capture(command, commandArgs, cwd) {
  return execFileSync(command, commandArgs, { cwd, encoding: 'utf8', shell: windows }).trim()
}

function hashOf(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  } catch {
    return null
  }
}

/** The files git would keep here (tracked and untracked, not ignored), relative, `/`-separated. */
function workingFiles(root) {
  return capture('git', ['ls-files', '-co', '--exclude-standard', '-z'], root)
    .split('\0')
    .filter((file) => file && fs.existsSync(path.join(root, file)))
}

/** Makes `dir`'s working tree the same as this one's; returns the files that changed. */
function mirror(dir) {
  const source = new Set(workingFiles(repo))
  const changed = []
  for (const file of source) {
    const from = path.join(repo, file)
    const to = path.join(dir, file)
    if (fs.statSync(from).isDirectory()) continue
    if (hashOf(from) === hashOf(to)) continue
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
    changed.push(file)
  }
  for (const file of workingFiles(dir)) {
    if (source.has(file)) continue
    fs.rmSync(path.join(dir, file), { force: true })
    changed.push(file)
  }
  return changed
}

/** Native config: when any of these changed, the Android project is made again. */
function nativeInputs(file) {
  return (
    file === 'mobile/app.config.ts' ||
    file === 'mobile/package.json' ||
    file === 'mobile/package-lock.json' ||
    file.startsWith('mobile/assets/') ||
    file.startsWith('mobile/plugins/')
  )
}

/** adb from ADB, the Android SDK (ANDROID_HOME, or the SDK's usual Windows place), else the PATH. */
function adbPath() {
  const name = windows ? 'adb.exe' : 'adb'
  const candidates = [
    process.env.ADB,
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', name),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', name)
  ].filter(Boolean)
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? 'adb'
}

function adb(commandArgs, serial) {
  const found = adbPath()
  return execFileSync(found, serial ? ['-s', serial, ...commandArgs] : commandArgs, {
    encoding: 'utf8'
  }).trim()
}

function findDevice(given) {
  if (given) return given
  const listed = () =>
    adb(['devices'])
      .split('\n')
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter(([serial, state]) => serial && state === 'device')
      .map(([serial]) => serial)
  let devices = listed()
  if (devices.length === 0) {
    // A phone with wireless debugging on announces itself; connect to the first one found.
    const service = adb(['mdns', 'services'])
      .split('\n')
      .map((line) => /_adb-tls-connect\._tcp\.?\s+([\d.]+:\d+)/.exec(line)?.[1])
      .find(Boolean)
    if (service) {
      say(`connecting to ${service}`)
      adb(['connect', service])
      devices = listed()
    }
  }
  // The same phone can be listed twice (its address and its mDNS name): prefer the address.
  const unique = [...new Set(devices)]
  const byAddress = unique.filter((serial) => /^[\d.]+:\d+$/.test(serial))
  const choice = byAddress.length === 1 ? byAddress : unique
  if (choice.length === 0) fail('no phone found; turn on wireless debugging, or plug it in')
  if (choice.length > 1) fail(`several devices (${choice.join(', ')}); pass --device`)
  return choice[0]
}

/** A value from the shared brand file (`appUserModelId: 'com.example.app'`). */
function brandValue(name) {
  const text = fs.readFileSync(path.join(repo, 'src', 'shared', 'brand.ts'), 'utf8')
  const value = new RegExp(`\\b${name}: '([^']+)'`).exec(text)?.[1]
  if (!value) fail(`src/shared/brand.ts has no ${name}`)
  return value
}

function main() {
  const options = args()
  const dir = path.resolve(options.dir ?? process.env.OSTLER_SIDELOAD_DIR ?? '')
  if (!options.dir && !process.env.OSTLER_SIDELOAD_DIR) fail('pass --dir <short folder>')
  if (windows && dir.length > MAX_DIR_LENGTH) fail(`${dir} is too long for CMake; use a short path`)
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fail(`${dir} is not a worktree; make it with: git worktree add --detach ${dir}`)
  }
  const apkFolder = path.join(dir, 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'release')
  const apk = path.join(apkFolder, 'app-release.apk')
  const env = { ...process.env, OSTLER_ANDROID_VARIANT: 'dev' }
  delete env.CI
  const r2File = options['r2-config'] ?? process.env.OSTLER_SIDELOAD_R2_CONFIG
  if (r2File) {
    let text
    try {
      text = JSON.stringify(JSON.parse(fs.readFileSync(r2File, 'utf8')))
    } catch {
      fail(`could not read the R2 settings in ${r2File}`)
    }
    env.EXPO_PUBLIC_OSTLER_BUILT_IN_R2 = Buffer.from(text, 'utf8').toString('base64')
    say('building the R2 bucket into the app')
  }

  if (!options.flags.has('install-only')) {
    const changed = mirror(dir)
    say(`${changed.length} file(s) copied into ${dir}`)
    const stamp = path.join(dir, 'mobile', 'android', '.sideload-native')
    const nativeHash = crypto
      .createHash('sha256')
      .update(
        ['mobile/app.config.ts', 'mobile/package-lock.json']
          .map((file) => hashOf(path.join(dir, file)) ?? '')
          .join()
      )
      .digest('hex')
    const lockChanged = changed.some((file) => file.endsWith('package-lock.json'))
    if (lockChanged || !fs.existsSync(path.join(dir, 'node_modules'))) {
      run('npm', ['ci', '--no-audit', '--no-fund'], dir, env)
    }
    if (lockChanged || !fs.existsSync(path.join(dir, 'mobile', 'node_modules'))) {
      run('npm', ['ci', '--no-audit', '--no-fund'], path.join(dir, 'mobile'), env)
    }
    const stale =
      options.flags.has('clean') ||
      !fs.existsSync(stamp) ||
      fs.readFileSync(stamp, 'utf8') !== nativeHash ||
      changed.some(nativeInputs)
    if (stale) {
      say('making the Android project (expo prebuild)')
      run(
        'npx',
        ['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install'],
        path.join(dir, 'mobile'),
        env
      )
      fs.writeFileSync(stamp, nativeHash)
    }
    const gradle = windows ? '.\\gradlew.bat' : './gradlew'
    const gradleArgs = [
      'assembleRelease',
      '-q',
      '--no-daemon',
      '--max-workers=1',
      '-PreactNativeArchitectures=arm64-v8a',
      '-Pkotlin.compiler.execution.strategy=in-process',
      '-Dorg.gradle.jvmargs=-Xmx1536m',
      ...(process.env.OSTLER_SIDELOAD_GRADLE_ARGS ?? '').split(' ').filter(Boolean)
    ]
    say('building the APK (a few minutes; longer after prebuild)')
    run(gradle, gradleArgs, path.join(dir, 'mobile', 'android'), env)
    if (!fs.existsSync(apk)) fail(`no APK at ${apk}`)
    say(`built ${apk} (${Math.round(fs.statSync(apk).size / 1e6)} MB)`)
  }
  if (options.flags.has('build-only')) return

  if (!fs.existsSync(apk)) fail(`no APK at ${apk}; build first`)
  const serial = findDevice(options.device ?? process.env.ANDROID_SERIAL)
  const pkg = `${brandValue('appUserModelId')}${PACKAGE_SUFFIX}`
  if (options.flags.has('clear')) {
    say(`clearing ${pkg}'s data`)
    try {
      adb(['shell', 'pm', 'clear', pkg], serial)
    } catch {
      // Not installed yet.
    }
  }
  say(`installing on ${serial}`)
  adb(['install', '-r', apk], serial)
  adb(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], serial)
  if (options['setup-code']) {
    const code = fs.readFileSync(options['setup-code'], 'utf8').trim()
    if (!code.startsWith('ostler-r2:')) fail('that file holds no setup code')
    // The app reads `<scheme>://r2-setup/<code>`; the code is sealed, the passphrase stays with the person.
    adb(
      [
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        `'${brandValue('urlScheme')}-dev://r2-setup/${encodeURIComponent(code)}'`,
        pkg
      ],
      serial
    )
    say('opened Advanced sync with the setup code; type its passphrase on the phone')
  }
  say('done')
}

main()
