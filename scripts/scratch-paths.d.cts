export const SCRATCH_ROOT: string
export const SCRATCH_PROJECTS_ROOT: string
export const SCRATCH_CONFIG: {
  harness: { enabled: boolean; port: number }
  automationApi: { enabled: boolean; port: number }
}
export function assertScratchName(name: unknown): string
export function isStrictlyInside(root: string, candidate: string): boolean
export function scratchDataDir(name: string): string
export function scratchProjectDir(name: string): string
export function assertDeletable(target: string): string
