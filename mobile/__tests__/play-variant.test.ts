import fs from 'fs'
import path from 'path'
import type { ExpoConfig } from 'expo/config'

/** app.config.ts evaluated with the given environment, as `expo prebuild` would see it. */
function configWith(env: Record<string, string | undefined>): ExpoConfig {
  const saved = { ...process.env }
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  try {
    let config: ExpoConfig | undefined
    jest.isolateModules(() => {
      config = (require('../app.config') as { default: ExpoConfig }).default
    })
    return config as ExpoConfig
  } finally {
    process.env = saved
  }
}

const PLAY_ENV = { OSTLER_ANDROID_VARIANT: undefined, EXPO_PUBLIC_OSTLER_BUILT_IN_R2: undefined }
const DEV_ENV = { OSTLER_ANDROID_VARIANT: 'dev', EXPO_PUBLIC_OSTLER_BUILT_IN_R2: undefined }

function pluginNames(config: ExpoConfig): string[] {
  return (config.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p) as string)
}

describe('the Play build (com.ostler.app)', () => {
  it('is the real package, not the dev one', () => {
    const play = configWith(PLAY_ENV)
    expect(play.android?.package).toBe('com.ostler.app')
    expect(configWith(DEV_ENV).android?.package).toBe('com.ostler.app.dev')
  })

  it('has the same native modules as the dev build', () => {
    const play = pluginNames(configWith(PLAY_ENV))
    expect(play).toEqual(pluginNames(configWith(DEV_ENV)))
    for (const name of [
      'expo-secure-store',
      'react-native-quick-crypto',
      'expo-notifications',
      'expo-share-intent',
      'expo-image-picker'
    ]) {
      expect(play).toContain(name)
    }
  })

  it('blocks nothing Advanced sync needs: no permission or cleartext overrides', () => {
    const android = configWith(PLAY_ENV).android ?? {}
    expect(android.blockedPermissions ?? []).not.toContain('android.permission.INTERNET')
    expect(android.permissions ?? []).toEqual(configWith(DEV_ENV).android?.permissions ?? [])
  })

  it('refuses built-in bucket keys, which are for the dev build only', () => {
    expect(() => configWith({ ...PLAY_ENV, EXPO_PUBLIC_OSTLER_BUILT_IN_R2: 'e30=' })).toThrow(
      /dev variant only/
    )
    expect(() => configWith({ ...DEV_ENV, EXPO_PUBLIC_OSTLER_BUILT_IN_R2: 'e30=' })).not.toThrow()
  })

  it('carries no bucket keys in its config', () => {
    const text = JSON.stringify(configWith(PLAY_ENV))
    expect(text).not.toMatch(/secretAccessKey|accessKeyId|BUILT_IN_R2/)
  })
})

describe('Advanced sync in Settings', () => {
  const src = path.join(__dirname, '..', 'src')
  const read = (file: string) => fs.readFileSync(path.join(src, file), 'utf8')

  it('is always shown, not only in dev builds', () => {
    const settings = read('screens/Settings.tsx')
    expect(settings).toMatch(/<AdvancedSync theme=\{theme\} \{\.\.\.r2\} \/>/)
    for (const file of ['screens/Settings.tsx', 'screens/AdvancedSync.tsx']) {
      expect(read(file)).not.toMatch(/__DEV__|OSTLER_ANDROID_VARIANT|\.dev['"]|BUILT_IN_R2/)
    }
  })
})
