import type { ExpoConfig } from 'expo/config'
import { withAppBuildGradle, type ConfigPlugin } from 'expo/config-plugins'
import path from 'path'
import { loadModuleSync } from '@expo/require-utils'
import type { BRAND as BrandType } from '../src/shared/brand'

// Expo compiles only this file; a plain `import` of the .ts brand file fails in Node's require.
const { BRAND } = loadModuleSync(path.join(__dirname, '../src/shared/brand.ts')) as {
  BRAND: typeof BrandType
}

// Identity comes from the shared brand file, never typed here. The Android package name is
// permanent once the app is on Play, so it is `BRAND.appUserModelId` and nothing else.
// The plugin wants an iOS URL scheme even though the app is Android-only. The value below is a
// placeholder; set it from the iOS client id if an iOS build is ever added.
const IOS_URL_SCHEME =
  process.env.OSTLER_GOOGLE_IOS_URL_SCHEME ?? 'com.googleusercontent.apps.ostler-android-only'

/**
 * Signs release builds with the Play upload key named in the user's own
 * `%USERPROFILE%\.gradle\gradle.properties` (OSTLER_UPLOAD_*; docs/mobile/releasing.md). Without
 * those properties a release build keeps the debug key, which Play refuses. Done here, not by
 * hand, so `npx expo prebuild --clean` keeps it.
 */
const withReleaseSigning: ConfigPlugin = (expoConfig) =>
  withAppBuildGradle(expoConfig, (gradle) => {
    let contents = gradle.modResults.contents
    if (contents.includes('OSTLER_UPLOAD_STORE_FILE')) return gradle
    contents = contents.replace(
      /signingConfigs \{\n(\s*)debug \{/,
      (match, indent: string) =>
        `signingConfigs {\n` +
        `${indent}if (findProperty('OSTLER_UPLOAD_STORE_FILE')) {\n` +
        `${indent}    release {\n` +
        `${indent}        storeFile file(OSTLER_UPLOAD_STORE_FILE)\n` +
        `${indent}        storePassword OSTLER_UPLOAD_STORE_PASSWORD\n` +
        `${indent}        keyAlias OSTLER_UPLOAD_KEY_ALIAS\n` +
        `${indent}        keyPassword OSTLER_UPLOAD_KEY_PASSWORD\n` +
        `${indent}    }\n` +
        `${indent}}\n` +
        match.slice('signingConfigs {\n'.length)
    )
    contents = contents.replace(
      /(release \{[^}]*?)signingConfig signingConfigs\.debug/,
      "$1signingConfig findProperty('OSTLER_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug"
    )
    if (!contents.includes('signingConfigs.release')) {
      throw new Error('withReleaseSigning: build.gradle no longer has the expected shape')
    }
    gradle.modResults.contents = contents
    return gradle
  })

const config: ExpoConfig = {
  name: BRAND.name,
  slug: BRAND.appUserModelId.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
  version: '1.0.1',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  scheme: BRAND.urlScheme,
  platforms: ['android'],
  android: {
    package: BRAND.appUserModelId,
    // Raise by one for every bundle uploaded to Play; Play refuses a number it has seen.
    versionCode: 2,
    adaptiveIcon: {
      backgroundColor: '#4f6fe0',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png'
    },
    predictiveBackGestureEnabled: false
  },
  plugins: [
    'react-native-quick-crypto',
    'expo-secure-store',
    // The launch screen: the Ostler mark on the theme's page colour (light and dark).
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 120,
        resizeMode: 'contain',
        backgroundColor: '#f6f7f9',
        dark: { image: './assets/splash-icon.png', backgroundColor: '#111318' }
      }
    ],
    ['@react-native-google-signin/google-signin', { iosUrlScheme: IOS_URL_SCHEME }]
  ]
}

export default withReleaseSigning(config)
