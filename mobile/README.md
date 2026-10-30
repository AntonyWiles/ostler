# Ostler for Android

The phone app for Ostler: check project status and edit tasks, synced with the desktop app through
Google Drive. It is a React Native app built with Expo, Android only. This step (prompt 07) is the
shell: it opens the phone's `ostler.db`, brings it up to date with the desktop's own migrations and
shows the schema version next to the latest known one. Both numbers match when it works.

## What it shares with the desktop app

- The schema: `electron/services/database/migrations/list.ts` is the list of migrations. The phone
  never defines tables of its own; schema changes are made as desktop migrations only.
- The sync engine in `electron/services/sync/`, once later steps load it. It reaches Node and
  Electron only through `platform.ts`; Metro swaps that file for `mobile/src/platform.ts`
  (see `metro.config.js`).
- Names and identity from `src/shared/brand.ts`, read in `app.config.ts`.

## Run it

You need the Android SDK, a JDK 17 and a phone (or emulator) that `adb devices` lists.

```
cd mobile
npm install
npx expo run:android
```

Keep the repository at a short path: CMake fails past Windows' 260-character limit.

Other scripts: `npm test` (jest), `npm run typecheck`, `npm run lint` (`npx expo lint`).

## Builds are local

There is no build service, workflow or CI job for this app. Builds run on your own machine with
`npx expo run:android`; `android/` is generated and not committed.
