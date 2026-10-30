/**
 * The palette projects, people and labels draw their colour from. Main and
 * the renderer read it from here, so a colour picker always offers the same
 * set the defaults come from.
 */
export const PROJECT_COLORS: readonly string[] = [
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#06b6d4', // cyan
  '#f97316', // orange
  '#84cc16', // lime
  '#6366f1' // indigo
]

/**
 * A stable palette colour for a key (a person's id, a label's name), so the
 * same key always gets the same colour without anything being stored.
 */
export function paletteColorFor(key: string): string {
  let hash = 0
  for (const char of key) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return PROJECT_COLORS[hash % PROJECT_COLORS.length]
}

/** Whether `value` is a colour Ostler stores: `#rrggbb`. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}
