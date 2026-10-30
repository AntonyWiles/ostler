export function isObject(value: unknown): value is Record<string, unknown>
export function textFrom(value: unknown): string
export function cleanText(value: unknown): string
export function firstString(...values: unknown[]): string
export function basenameAny(value: string): string
export function normalizePathReference(value: string): string
export function sanitizePathReference(
  value: string,
  metadata: { directory: string; projectName: string }
): string
export function sanitizeText(
  text: string,
  metadata: {
    directory: string
    projectName: string
    repositoryUrl?: string
    stripUrls?: boolean
  }
): string
export function comparablePath(value: string): string
export function projectFolderName(project: { path: string; name: string }): string
export function projectMatch(
  metadata: { directory: string; projectName: string },
  projects?: { id: string; path: string; name: string }[]
):
  | { status: 'matched'; id: string; name: string }
  | { status: 'ambiguous'; candidates: { id: string; name: string }[] }
  | { status: 'unmatched' }
  | { status: 'unresolved' }
