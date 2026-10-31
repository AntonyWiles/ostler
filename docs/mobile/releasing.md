# Releasing Ostler for Android

How the phone app gets from this repository to testers on Google Play. The desktop app is released
a different way (see [releasing.md](../releasing.md)). The phone app is built on your own PC: there
is no build service, workflow or CI job for it, and nothing here is automatic.

The Android package name is `com.ostler.app`. It comes from `BRAND.appUserModelId` in
`src/shared/brand.ts`, and `mobile/app.config.ts` reads it from there. **It is permanent once the
app is on Play**, so do not change it.

You need the Android SDK, JDK 17 and the rest of the setup in
[mobile/README.md](../../mobile/README.md). Release bundles are built from a second checkout at a
short path (step 3): CMake fails past the 260 character limit on Windows paths.

## 1. Make the upload key (once)

Play signs the app that people install with its own key (Play App Signing). You sign each upload
with an **upload key** that you keep. Make it once and keep it for good.

1. In PowerShell, in a folder outside the repository (for example `C:\Users\you\ostler-keys`), run:

   ```
   keytool -genkeypair -v -storetype PKCS12 -keystore ostler-upload.jks -alias ostler-upload -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Choose a strong store password and keep it in your password manager. Answer the name questions
   however you like.
3. Back up `ostler-upload.jks` and its password somewhere safe, apart from this PC. If you lose the
   upload key you can ask Play to reset it, but that takes days.
4. Print the key's SHA-1, which you need in step 4 below:

   ```
   keytool -list -v -keystore ostler-upload.jks -alias ostler-upload
   ```

   Copy the line that starts `SHA1:`.

Never put the keystore, its password or a `gradle.properties` holding them in Git. `mobile/android/`
is generated and ignored by `mobile/.gitignore`; keep the keystore outside the repository entirely.

## 2. Tell Gradle about the key

`npx expo prebuild` generates `mobile/android/`. Its release build is signed with the debug key
unless Gradle knows the upload key, and Play refuses such a bundle.

1. In `%USERPROFILE%\.gradle\gradle.properties` (your user file, not one in the repository) add:

   ```
   OSTLER_UPLOAD_STORE_FILE=C:\\Users\\you\\ostler-keys\\ostler-upload.jks
   OSTLER_UPLOAD_KEY_ALIAS=ostler-upload
   OSTLER_UPLOAD_STORE_PASSWORD=your store password
   OSTLER_UPLOAD_KEY_PASSWORD=your key password
   ```

2. That is all. `withReleaseSigning` in `mobile/app.config.ts` adds the `release` signing config
   to `mobile/android/app/build.gradle` on every `npx expo prebuild`, so nothing is edited by hand.
   Without these properties a release build keeps the debug key, which Play refuses.

## 3. Build the bundle

Before each upload that Play has not seen:

1. **Raise the version**, in your usual checkout:

   ```
   cd mobile
   npm run release:android -- --bump
   ```

   This raises `android.versionCode` by one and the patch part of `version` in
   `mobile/app.config.ts`. Play rejects a bundle whose `versionCode` it has already seen. Add the
   changes to `CHANGELOG.md` and commit.

2. **Build from a short checkout.** On Windows the native build fails when the repository's path
   is long (CMake stops at 260 characters), and a drive mapped with `subst` does not help. Keep a
   second checkout at a short path as a Git worktree, made once:

   ```
   git worktree add --detach C:\o\rel main
   ```

   For each release, move it to the commit you just made and build:

   ```
   cd C:\o\rel
   git checkout --detach main
   cd mobile
   npm ci
   npm run release:android
   ```

   The script refuses a long path and uncommitted changes, so every bundle matches a commit. It
   runs `npx expo prebuild`, then `gradlew bundleRelease`, stops if the bundle is signed with the
   debug key, and prints the version, the commit and the bundle's SHA-1, which must match the
   upload key's. The bundle is `mobile/android/app/build/outputs/bundle/release/app-release.aab`
   in the short checkout.

To try a release build on your own phone before uploading, `./gradlew assembleRelease` makes an APK
you can install with `adb install`. Play takes the bundle, not the APK.

## 4. Google sign-in for each key

The phone signs in through Google Play services, which only trusts an app whose package name and
signing key match an **Android OAuth client** in the Google Cloud project. Each key needs its own
client. All of them live in the same project as the desktop client and use the same package name.

| Key                                | Used for                                        | Where its SHA-1 comes from                                                   |
| ---------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| Debug key                          | `npx expo run:android` on your own phone        | `cd mobile/android && ./gradlew signingReport`, the `debug` variant's `SHA1` |
| Upload key                         | A release build you install yourself with `adb` | Step 4 of "Make the upload key"                                              |
| App signing key (Play App Signing) | What testers install from Play                  | Play Console › your app › Test and release › App signing                     |

For each key without a client yet: Google Cloud console › APIs and Services › Credentials › Create
credentials › OAuth client ID › type **Android**, package name `com.ostler.app`, that key's SHA-1.
A new client takes a few minutes to start working. Without the **app signing key**'s client,
sign-in works on your own builds and fails for every tester from Play with a "developer error" or
"configuration" message. Testers sign in only once they are listed as test users on the Google
Cloud consent screen.

## 5. Play Console

Setting up the account and the app is yours to do in the console; nothing in this repository does
it for you.

1. **Developer account.** Create one at play.google.com/console (there is a one-off fee). Verify
   your identity when asked.
2. **Create the app.** Create app, name `Ostler`, default language, **App**, **Free**, and accept
   the declarations.
3. **Play App Signing.** On the first upload, accept Play App Signing (the default). Play keeps the
   key that signs what testers receive; you keep the upload key. The app signing key's SHA-1 is then
   under Test and release › App signing: add its Android OAuth client as in step 4.
4. **Store listing.** Fill in the short and full description, the icon (512 px), a feature graphic
   (1024 by 500 px) and at least two phone screenshots. The privacy policy address is
   https://antonywiles.github.io/ostler/privacy/ (see [Publish the privacy page](#publish-the-privacy-page)).
5. **App content.** Complete every item Play lists: the privacy policy address, **Ads** (no ads),
   **App access** (the app needs a Google sign-in: give Play a test Google account that is on the
   test-user list in Google Cloud), the **Content rating** questionnaire, **Target audience** (not
   for children), **Data safety** (answers in [data-safety.md](data-safety.md)) and the other
   declarations.
6. **Internal testing first.** Test and release › Testing › Internal testing › Create new release,
   upload the `.aab`, name the release and save. Add up to 100 internal testers by email list. They
   get a link to opt in, and the app reaches their phones within minutes. Use this to check the app
   installs and signs in from Play before anything wider.
7. **Closed testing.** When internal testing works, make a Closed testing release the same way,
   choose a tester list (a list of Google account emails, or a Google group) and send the testers
   the opt-in link.

## The 12-tester rule

Which rule applies depends on your developer account. Play Console › Dashboard says what the app
still needs before you can apply for production.

- **A personal account created after 13 November 2023** must run a closed test with **at least 12
  testers opted in for 14 days in a row** before it can apply for production access. The testers must
  stay opted in the whole time. After that, use **Apply for production** and answer the questions
  about the test.
- **An organisation account, or a personal account created before that date,** does not need the
  closed test and can apply for production once the other checks in the Dashboard are done.

If you are unsure which you have, the Dashboard's checklist is the answer.

Whatever Play allows, **Ostler stays in Google's testing mode**: the Google Cloud
consent screen lists at most 100 test users, and each tester's Google sign-in expires after 7 days
(they sign in again from the app's Settings). Ostler is not for sale, so it is not put through
Google's verification. In practice a closed
test, or an internal test list, is how people get this app.

## After each release

1. Put the changes in `CHANGELOG.md` under Unreleased.
2. Check that testers can sign in and that My Day, a project and a task open.
3. If you changed what the app does with data, update [privacy-policy.md](privacy-policy.md),
   publish it again (below) and update the Data safety form in Play Console before you upload.

## Publish the privacy page

Play links to https://antonywiles.github.io/ostler/privacy/. GitHub Pages serves it from the
`gh-pages` branch, which holds only the page that `npm run privacy:page` builds from
[privacy-policy.md](privacy-policy.md). Nothing runs on GitHub to build it.

1. Once, in the repository on GitHub: Settings › Pages › Build and deployment › Source **Deploy
   from a branch**, branch `gh-pages`, folder `/ (root)`. The branch must exist first (step 2).
2. Each time the policy changes, from the repository root:

   ```bash
   npm run privacy:page
   cd out/privacy-page
   git init -b gh-pages
   git add -A
   git commit -m "Publish the privacy page"
   git push --force https://github.com/AntonyWiles/ostler.git gh-pages
   ```

   The branch is rebuilt each time, so the force push replaces it. Open the address afterwards and
   check the date at the top.
