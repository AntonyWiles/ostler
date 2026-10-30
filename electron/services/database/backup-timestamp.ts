/** File-name-safe UTC timestamp that sorts chronologically: `20261008-101500-123`. */
export function backupTimestamp(date = new Date()): string {
  const iso = date.toISOString() // 2026-10-08T10:15:00.123Z
  return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}-${iso.slice(20, 23)}`
}
