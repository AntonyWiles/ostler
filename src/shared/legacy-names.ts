/**
 * The names the product used before it was renamed from Nexus Dashboard to
 * Ostler. Data written under these names is read and moved to the new ones
 * (the data folder and its database at start-up, `electron/app/rename-migration.ts`;
 * Git refs, the `ostler-names` database migration, the config migration and the
 * renderer's saved view settings); nothing is written under them again.
 *
 * Task copies made before the rename stay on their `nexus/<slug>` versions, which
 * are still Ostler's own: `isOwnTaskBranch` is the one rule for both prefixes.
 */
export const LEGACY_NAMES = {
  dataFolderName: 'nexus-dashboard',
  databaseFile: 'nexus.db',
  userDataEnv: 'NEXUS_USER_DATA',
  secretPrefix: 'nexus-secure:v1:',
  urlScheme: 'nexus-dashboard',
  projectFileExtension: '.nexus-project',
  branchPrefix: 'nexus/',
  refsNamespace: 'refs/nexus/',
  localStoragePrefix: 'nexus.',
  projectPackageFormat: 'nexus-project-package'
} as const

/** The prefix of every version Ostler makes for a task copy. */
export const TASK_BRANCH_PREFIX = 'ostler/'

/** True for a version Ostler made for a task copy, before or after the rename. */
export function isOwnTaskBranch(branchName: string | null | undefined): boolean {
  return (
    !!branchName &&
    (branchName.startsWith(TASK_BRANCH_PREFIX) || branchName.startsWith(LEGACY_NAMES.branchPrefix))
  )
}

/** A task copy's version without its prefix: `ostler/fix-login` and `nexus/fix-login` give `fix-login`. */
export function taskBranchSlug(branchName: string): string {
  if (branchName.startsWith(TASK_BRANCH_PREFIX)) return branchName.slice(TASK_BRANCH_PREFIX.length)
  if (branchName.startsWith(LEGACY_NAMES.branchPrefix))
    return branchName.slice(LEGACY_NAMES.branchPrefix.length)
  return branchName
}
