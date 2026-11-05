#!/usr/bin/env node
/**
 * Serves this working tree's phone JavaScript to the "Ostler Dev" development client (built with
 * `sideload-android.cjs --dev-client`), so a JavaScript change shows on the phone after a reload
 * instead of a new APK.
 *
 *   node mobile/scripts/metro-dev.cjs [--device <serial>] [--r2-config <file>]
 *
 *   --device <serial>   The phone, as `adb devices` lists it (or ANDROID_SERIAL).
 *   --r2-config <file>  The same R2 setup file the sideload takes (or OSTLER_SIDELOAD_R2_CONFIG), so
 *                       the JavaScript Metro serves has the built-in bucket too.
 *
 * It points the phone's port 8081 at the PC (`adb reverse`), starts Metro, and opens the app on it.
 * Metro keeps running until stopped; press `r` in it to reload the app.
 */
const { spawn } = require('node:child_process')
const path = require('node:path')
const { adb, brandValue, devEnv, findDevice, PACKAGE_SUFFIX } = require('./sideload-android.cjs')

const mobile = path.resolve(__dirname, '..')
const PORT = 8081

const given = process.argv.slice(2)
const options = {}
for (let i = 0; i < given.length; i++) {
  if (['--device', '--r2-config'].includes(given[i])) options[given[i].slice(2)] = given[++i]
  else {
    console.error(`metro-dev: unknown option ${given[i]}`)
    process.exit(1)
  }
}

const env = devEnv(options['r2-config'] ?? process.env.OSTLER_SIDELOAD_R2_CONFIG)
const serial = findDevice(options.device ?? process.env.ANDROID_SERIAL)
adb(['reverse', `tcp:${PORT}`, `tcp:${PORT}`], serial)

const metro = spawn('npx', ['expo', 'start', '--dev-client', '--port', String(PORT)], {
  cwd: mobile,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32'
})
metro.on('exit', (code) => process.exit(code ?? 0))

// Once Metro is listening, open the development client on it.
const url = `http://localhost:${PORT}`
const scheme = `${brandValue('urlScheme')}-dev`
const pkg = `${brandValue('appUserModelId')}${PACKAGE_SUFFIX}`
const started = Date.now()
const timer = setInterval(async () => {
  try {
    const response = await fetch(`${url}/status`)
    if (!(await response.text()).includes('running')) return
  } catch {
    if (Date.now() - started > 120_000) clearInterval(timer)
    return
  }
  clearInterval(timer)
  const link = `${scheme}://expo-development-client/?url=${encodeURIComponent(url)}`
  adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${link}'`, pkg], serial)
}, 1000)
