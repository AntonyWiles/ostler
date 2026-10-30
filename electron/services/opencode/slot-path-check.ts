import * as path from 'path'

/**
 * Validates that a target path resolves inside the designated workspace slot directory.
 * Returns true if valid, false if the path escapes the slot boundary.
 *
 * This check is applied at the tool/plugin layer. It is currently the ONLY boundary keeping
 * an embedded agent inside its own worktree -- there is no OS-level Low Integrity enforcement
 * backing it (removed 2026-08-28 because Git Bash/MSYS2 cannot run under Low Integrity at all;
 * see docs/architecture-decisions/002-embedded-agent-sessions.md and the `launch` doc comment
 * on `OpenCodeRunnerDeps` in opencode-runner-service.ts). Treat this check accordingly: it is
 * advisory-strength, not a real security boundary, and can in principle be bypassed by a tool
 * call this validation doesn't cover.
 */
export function isPathWithinSlot(slotPath: string, targetPath: string): boolean {
  if (!targetPath || !slotPath) return false
  const absSlot = path.resolve(slotPath)
  const absTarget = path.resolve(slotPath, targetPath)

  // Normalize case-insensitively on Windows
  const lowerSlot = absSlot.toLowerCase()
  const lowerTarget = absTarget.toLowerCase()

  if (lowerTarget === lowerSlot) return true

  const relative = path.relative(absSlot, absTarget)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return false
  }

  // Ensure target starts with slot root directory prefix
  const slotPrefix = lowerSlot.endsWith(path.sep) ? lowerSlot : lowerSlot + path.sep
  return lowerTarget.startsWith(slotPrefix)
}

/**
 * Asserts that targetPath is within slotPath, throwing a descriptive Error if not.
 */
export function assertPathWithinSlot(
  slotPath: string,
  targetPath: string,
  toolName = 'tool'
): void {
  if (!isPathWithinSlot(slotPath, targetPath)) {
    throw new Error(
      `Ostler defense-in-depth: ${toolName} execution outside workspace slot is blocked (${targetPath})`
    )
  }
}
