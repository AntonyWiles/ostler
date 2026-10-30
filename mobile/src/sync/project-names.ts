import * as SecureStore from 'expo-secure-store'
import { isHexColor } from '../../../src/shared/project-colors'

/**
 * Joined projects' names and colours. The phone has no config store like the desktop's, and the
 * database holds no project settings, so each is kept under its own key (neither is a secret; the
 * store is simply the one place the phone already has for small values).
 */
const keyFor = (projectId: string): string => `ostler-project-name-${projectId}`
const colorKeyFor = (projectId: string): string => `ostler-project-color-${projectId}`

export function rememberProjectName(projectId: string, name: string): void {
  SecureStore.setItem(keyFor(projectId), name)
}

export function projectNameOf(projectId: string): string | null {
  return SecureStore.getItem(keyFor(projectId))
}

/** Remembers a project's colour; a value that is not `#rrggbb` is ignored. */
export function rememberProjectColor(projectId: string, color: string | undefined): void {
  if (isHexColor(color)) SecureStore.setItem(colorKeyFor(projectId), color)
}

export function projectColorOf(projectId: string): string | null {
  const color = SecureStore.getItem(colorKeyFor(projectId))
  return isHexColor(color) ? color : null
}
