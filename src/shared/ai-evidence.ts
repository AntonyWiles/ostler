/**
 * Fit a record's text into model evidence. A bare `slice` cut descriptions
 * mid-word, and models then reported the record itself as truncated and asked
 * the owner to check it. This cuts at a word boundary and says plainly that
 * Ostler shortened it, so every model reads the cut as Ostler's, not the record's.
 */
export function clipForModel(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const boundary = cut.search(/\s\S*$/)
  const kept = (boundary > max * 0.5 ? cut.slice(0, boundary) : cut).trimEnd()
  return `${kept} … [Ostler shortened this to fit; the full record is ${text.length - kept.length} characters longer and is not incomplete]`
}

/**
 * A per-record limit from a shared budget, so one linked record gets its
 * whole text while a hundred still fit.
 */
export function perRecordBudget(count: number, total: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(total / Math.max(count, 1))))
}
