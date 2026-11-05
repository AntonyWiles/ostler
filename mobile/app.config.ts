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
 * `OSTLER_ANDROID_VARIANT=dev` builds a separate test app beside the real one: its own package
 * (`<package>.dev`), name and link scheme, so it has its own empty database, never shares the real
 * app's data, and can be filled with made-up data for trying screens out. Never for Play.
 */
const DEV_VARIANT = process.env.OSTLER_ANDROID_VARIANT === 'dev'

// A test build can carry a bucket and its keys (sideload-android.cjs --r2-config). Expo inlines the
// variable into the JavaScript bundle, so a build of the real app with it set would ship the keys.
if (!DEV_VARIANT && process.env.EXPO_PUBLIC_OSTLER_BUILT_IN_R2) {
  throw new Error(
    'EXPO_PUBLIC_OSTLER_BUILT_IN_R2 is set for a build of the real app; unset it. Built-in bucket ' +
      'keys are for the dev variant only (OSTLER_ANDROID_VARIANT=dev).'
  )
}

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

/**
 * Caps the native build at six compiles at a time. Ninja otherwise runs one clang per core, and on
 * a many-core Windows PC the React Native headers make those run out of memory
 * ("LLVM ERROR: out of memory"). All native modules build inside the app's one CMake project, so
 * this one setting covers them.
 */
const withNativeCompileCap: ConfigPlugin = (expoConfig) =>
  withAppBuildGradle(expoConfig, (gradle) => {
    if (gradle.modResults.contents.includes('CMAKE_JOB_POOLS')) return gradle
    gradle.modResults.contents +=
      '\n// Caps parallel native compiles: one clang per core runs out of memory on Windows.\n' +
      'android { defaultConfig { externalNativeBuild { cmake { arguments ' +
      '"-DCMAKE_JOB_POOLS=compile=6", "-DCMAKE_JOB_POOL_COMPILE=compile" } } } }\n'
    return gradle
  })

const config: ExpoConfig = {
  name: DEV_VARIANT ? `${BRAND.name} Dev` : BRAND.name,
  slug: BRAND.appUserModelId.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
  version: '1.0.2',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  scheme: DEV_VARIANT ? `${BRAND.urlScheme}-dev` : BRAND.urlScheme,
  platforms: ['android'],
  android: {
    package: DEV_VARIANT ? `${BRAND.appUserModelId}.dev` : BRAND.appUserModelId,
    // Raise by one for every bundle uploaded to Play; Play refuses a number it has seen.
    versionCode: 3,
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
    // Local notifications: reminders, the Today summary, the running timer, new Inbox items and
    // sync trouble. Adds POST_NOTIFICATIONS (asked for on Android 13+ when first useful).
    ['expo-notifications', { icon: './assets/android-icon-monochrome.png', color: '#4f6fe0' }],
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
    ['@react-native-google-signin/google-signin', { iosUrlScheme: IOS_URL_SCHEME }],
    // Voice memos on tasks: recording, and writing out what was said as it is said.
    ['expo-audio', { microphonePermission: 'Record voice memos for your tasks.' }],
    [
      'expo-speech-recognition',
      {
        microphonePermission: 'Record voice memos for your tasks.',
        speechRecognitionPermission: 'Write out what you say in a voice memo.',
        androidSpeechServicePackages: [
          'com.google.android.googlequicksearchbox',
          'com.google.android.as',
          'com.google.android.tts'
        ]
      }
    ],
    // Photos and files added to a project's Library: the camera, and pictures already taken.
    [
      'expo-image-picker',
      {
        cameraPermission: 'Take photos for your project Library.',
        photosPermission: 'Add photos to your project Library.',
        microphonePermission: false
      }
    ]
  ]
}

// The dev variant is never uploaded: its release build (the sideload APK) keeps the debug key, so it
// installs over a debug build of the same variant without losing its data.
export default withNativeCompileCap(DEV_VARIANT ? config : withReleaseSigning(config))
