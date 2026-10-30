import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { applyLocale } from '@shared/i18n'
import { loadLazyComponents } from '@renderer/lib/lazy-named'
import { forgetShown } from '@renderer/lib/shown-cache'

// Make every test independent of the machine it runs on. Lists, dates and
// numbers follow the OS locale, so pin the one the expectations were written
// in (en-US adds an Oxford comma).
applyLocale({ language: 'en', formatLocale: 'en-NZ' })

// Nor of the environment it was started from: `offScreen` (electron/app/off-screen.ts)
// is read from OSTLER_OFF_SCREEN and OSTLER_ON_SCREEN when its module loads, so a run
// started with OSTLER_OFF_SCREEN=1 (as e2e runs are) held back the notifications the
// notification tests expect to see. Every test starts on screen; one about off-screen
// behaviour sets the variable itself, and a test that starts Electron passes it on.
delete process.env['OSTLER_OFF_SCREEN']
delete process.env['OSTLER_ON_SCREEN']

// Git refuses to commit without an identity, which a CI runner doesn't have.
// Give it a global one only then: GIT_AUTHOR_* would override the identities
// tests set in their own repositories.
if (spawnSync('git', ['config', 'user.email'], { encoding: 'utf8' }).stdout.trim() === '') {
  const config = join(mkdtempSync(join(tmpdir(), 'ostler-git-')), 'gitconfig')
  writeFileSync(config, '[user]\n\tname = Ostler Tests\n\temail = tests@ostler.invalid\n')
  process.env.GIT_CONFIG_GLOBAL = config
}

// Node 25 and later ship their own `localStorage`, which is undefined unless Node is
// started with --localstorage-file. Vitest's jsdom environment sees the name is taken
// and leaves it, so component tests find no storage at all. Put jsdom's back.
// Vitest keeps the jsdom instance as `jsdom`; its window still has the storage.
const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window
if (jsdomWindow && typeof globalThis.localStorage === 'undefined') {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, name, { value: jsdomWindow[name], configurable: true })
  }
}

// A lazy component's chunk (lazyNamed) is compiled the first time it renders,
// which a busy machine can make take longer than the second Testing Library
// waits for what it shows. The test file's modules are imported by now, so
// their lazy components' code loads here, before any test, as it would be in
// the app's own bundle. Compiling is the slow part, hence the time.
beforeAll(() => loadLazyComponents(), 60_000)

afterEach(() => {
  cleanup()
  // Views keep what they showed for going back to them: no test sees another's.
  forgetShown()
})
