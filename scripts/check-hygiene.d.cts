export function forbiddenPathReason(file: string): string | null
export function contentProblems(
  file: string,
  text: string,
  personal: [RegExp, string][]
): string[]
export function personalPatterns(identity: {
  email?: string
  userName?: string
  homeDir?: string
}): [RegExp, string][]
