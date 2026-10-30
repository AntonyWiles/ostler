import { join } from 'path'
import { BRAND } from '@shared/brand'
import { LEGACY_NAMES } from '@shared/legacy-names'

/** The argument a development run's shell entries carry its data folder in (P8.2). */
export const USER_DATA_ARGUMENT = '--ostler-user-data='

/**
 * Where Ostler keeps its runtime data: `OSTLER_USER_DATA` when set, otherwise
 * `<appData>/<BRAND.dataFolderName>`. Pinned explicitly so the folder never
 * follows Electron's name-derived default, which would move every user's data
 * if the package or product name changed.
 *
 * A development build also reads `--ostler-user-data=<folder>` from its
 * arguments: that is how a deep link or jump-list entry a scratch run
 * registered (OSTLER_SHELL_INTEGRATION=1) starts Ostler against the same
 * scratch folder rather than the default one. A packaged build ignores it.
 */
export function resolveDataDir(
  env: NodeJS.ProcessEnv,
  appDataPath: string,
  argv: readonly string[] = [],
  packaged = true
): string {
  // NEXUS_USER_DATA is the variable's name from before the rename (legacy-names.ts).
  const override = env.OSTLER_USER_DATA || env[LEGACY_NAMES.userDataEnv]
  if (override) return override
  if (!packaged) {
    const argument = argv.find((arg) => arg.startsWith(USER_DATA_ARGUMENT))
    const folder = argument?.slice(USER_DATA_ARGUMENT.length)
    if (folder) return folder
  }
  return join(appDataPath, BRAND.dataFolderName)
}
