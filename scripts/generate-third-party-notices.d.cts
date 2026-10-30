export interface NoticePackage {
  name: string
  version: string
  path: string
  license: string | null
}
export interface NoticeEntry {
  name: string
  version: string
  license: string | null
  text: string | null
}
/** Flattens an `npm ls --json --long` tree into unique packages, sorted by name. */
export function collectPackages(tree: unknown): NoticePackage[]
/** Why a licence expression is refused, or null when it is allowed. */
export function policyProblem(license: string | null): string | null
/** Applies overrides and licence texts; problems lists every policy refusal. */
export function resolveEntries(
  packages: NoticePackage[],
  readText?: (dir: string) => string | null
): { entries: NoticeEntry[]; problems: string[] }
/** The notices file for resolved entries. */
export function renderNotices(entries: NoticeEntry[]): string
export function licenseOf(pkg: unknown): string | null
