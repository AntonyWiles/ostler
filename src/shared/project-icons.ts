/**
 * The curated project icons (N5.1, N36): an optional shape beside a project's
 * colour, so it can be told apart without colour. `WatchedProject.icon` holds
 * one of these ids, or nothing. The glyphs are in
 * `src/renderer/components/project-icon-glyphs.ts`; only these are bundled.
 */
export const PROJECT_ICONS = [
  'house',
  'briefcase',
  'plane',
  'book',
  'heart',
  'wrench',
  'code',
  'car',
  'bike',
  'baby',
  'dog',
  'cat',
  'paw',
  'tree',
  'flower',
  'leaf',
  'sprout',
  'sun',
  'moon',
  'star',
  'camera',
  'music',
  'film',
  'gamepad',
  'palette',
  'brush',
  'pen',
  'graduation',
  'school',
  'dumbbell',
  'utensils',
  'coffee',
  'cake',
  'gift',
  'shopping',
  'wallet',
  'piggy-bank',
  'landmark',
  'building',
  'store',
  'hammer',
  'globe',
  'map',
  'mountain',
  'tent',
  'ship',
  'train',
  'rocket',
  'lightbulb',
  'flask',
  'laptop',
  'smartphone',
  'server',
  'database',
  'megaphone',
  'mail',
  'users',
  'user',
  'calendar',
  'clipboard',
  'folder',
  'file',
  'trophy',
  'flag',
  'target',
  'stethoscope',
  'shirt',
  'sofa',
  'key',
  'package',
  'truck'
] as const

export type ProjectIcon = (typeof PROJECT_ICONS)[number]

export function isProjectIcon(value: unknown): value is ProjectIcon {
  return typeof value === 'string' && (PROJECT_ICONS as readonly string[]).includes(value)
}

/**
 * A project icon as saved: an id from the curated set, or null for none
 * (null, '' or undefined). Anything else is refused, whichever surface sent it.
 */
export function normalizeProjectIcon(value: unknown): ProjectIcon | null {
  if (value === null || value === undefined || value === '') return null
  if (!isProjectIcon(value)) throw new Error(`Unknown project icon: ${String(value)}`)
  return value
}
