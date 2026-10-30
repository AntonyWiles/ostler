/**
 * Up to two initials from a name: "Ada Lovelace" → "AL", "ostler" → "N". The
 * one rule for a person's initials, wherever they are shown or stored.
 */
export function initialsFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters = words.length === 1 ? [words[0][0]] : [words[0][0], words[words.length - 1][0]]
  return letters.join('').toUpperCase()
}
