/**
 * The narrowest a Markdown table's column gets, in points: a few words to a
 * line. Sharing a phone's width between many columns would leave each a word
 * or a few letters wide, so the text read down the screen; past this the
 * table scrolls sideways instead.
 */
export const MIN_COLUMN_WIDTH = 112

/** Each column's width: an even share of `available`, never under MIN_COLUMN_WIDTH. */
export function tableColumnWidth(columns: number, available: number): number {
  if (columns < 1) return available
  return Math.max(MIN_COLUMN_WIDTH, Math.floor(available / columns))
}
