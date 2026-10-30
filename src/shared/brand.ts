/**
 * The single source of the product's identity: its display names, Windows
 * identity, data folder and links. The public name may change before release
 * (roadmap D3), so the app's chrome reads these values instead of typing the
 * name out. `scripts/check-brand.cjs` (run by `npm run lint`) keeps
 * package.json (`build.productName`, `build.appId`, the deep-link scheme, the
 * publisher in `author` and the GitHub release feed in `build.publish`) and
 * the uninstaller's data folder (`build/installer.nsh`) in step with this file.
 *
 * The product was called Nexus Dashboard until October 2026. What that name
 * left on disk (the data folder, `nexus.db`, `nexus/*` versions and
 * `refs/nexus/`, sealed secrets, links and project files) is listed in
 * `legacy-names.ts`, read there and moved to these names; never write the old
 * ones. Changing a value here again means another such migration.
 */
export const BRAND = {
  name: 'Ostler', // shown in the UI
  fullName: 'Ostler', // window title, installer, About
  publisher: 'Ostler', // the installer's publisher, in Windows' installed apps list
  aiName: 'Ostler AI',
  // The built-in sample project (P5.8), found by this name: changing it needs
  // a config migration that renames the one already made (see version 43).
  sampleProjectName: 'Welcome to Ostler (Demo Project)',
  // The advanced demo, found by this name in the same way.
  advancedDemoProjectName: 'Harbour Café refit (Advanced Demo)',
  appUserModelId: 'com.ostler.app', // Windows notifications identity: never change casually
  dataFolderName: 'ostler', // under %APPDATA%: never change, or every user's data moves
  // Deep links (P8.2): ostler://inbox. Registered with Windows, so
  // changing it breaks every link and jump-list entry already handed out.
  urlScheme: 'ostler',
  repositoryUrl: 'https://github.com/AntonyWiles/ostler',
  issuesUrl: 'https://github.com/AntonyWiles/ostler/issues'
} as const
