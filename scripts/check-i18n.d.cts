export const ALLOWLIST: Record<string, string>
export const TEXT_PROPS: Set<string>
export function jsxText(raw: string): string
export function checkRendererSource(
  source: string,
  file?: string
): { line: number; message: string }[]
export function keysInSource(
  source: string,
  file?: string
): { exact: Set<string>; prefixes: Set<string> }
export function sourceHash(text: string): string
export function requiredKeys(english: Map<string, string>, language: string): Map<string, string[]>
export function stampedLock(languages: Map<string, Map<string, string>>): Record<string, string>
export function translationProblems(
  languages: Map<string, Map<string, string>>,
  lock: Map<string, string>
): string[]
export function check(options?: { root?: string; locales?: string; lockFile?: string }): {
  errors: string[]
  warnings: string[]
}
