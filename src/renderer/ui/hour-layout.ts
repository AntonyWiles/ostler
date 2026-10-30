/*
 * The hour grid's layout (N3.4a): timed items in one day's column, by
 * minutes after midnight. Items that overlap share the width: each cluster
 * of overlapping items is split into as many columns as it needs, and each
 * item takes the first column free at its start.
 */

const MINUTES_PER_DAY = 24 * 60

/** Something with a time on a day: a time block or a timed event. */
export interface HourItem {
  id: string
  /** Minutes after midnight. */
  start: number
  /** Minutes after midnight, after `start`; at most 1440. */
  end: number
}

export interface HourPlace<T extends HourItem> {
  item: T
  /** Its column within its cluster, from 0. */
  column: number
  /** How many columns its cluster has. */
  columns: number
}

/** A timed span on one day, cut to that day: [start, end) in minutes, or null when it misses it. */
export function minutesOnDay(
  day: string,
  span: { startDate: string; endDate: string; startTime: string | null; endTime: string | null }
): { start: number; end: number } | null {
  if (span.startTime === null || day < span.startDate || day > span.endDate) return null
  const minutes = (time: string | null) => {
    const [hours, mins] = (time ?? '00:00').split(':').map(Number)
    return hours * 60 + mins
  }
  const start = day === span.startDate ? minutes(span.startTime) : 0
  const end = day === span.endDate ? minutes(span.endTime) : MINUTES_PER_DAY
  if (end <= start)
    return day === span.startDate ? { start, end: Math.min(start + 15, 1440) } : null
  return { start, end }
}

/** Places a day's timed items: ordered by start, then the longer first; overlaps side by side. */
export function layoutHourItems<T extends HourItem>(items: readonly T[]): HourPlace<T>[] {
  const sorted = items
    .map((item) => ({
      item,
      start: item.start,
      end: Math.min(MINUTES_PER_DAY, Math.max(item.end, item.start + 1))
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end || a.item.id.localeCompare(b.item.id))
  const places: HourPlace<T>[] = []
  let cluster: { place: HourPlace<T>; end: number }[] = []
  let clusterEnd = -1
  const close = () => {
    const columns = Math.max(1, ...cluster.map((entry) => entry.place.column + 1))
    for (const entry of cluster) entry.place.columns = columns
    cluster = []
  }
  for (const { item, start, end } of sorted) {
    if (start >= clusterEnd) {
      close()
      clusterEnd = -1
    }
    const taken = new Set(
      cluster.filter((entry) => entry.end > start).map((entry) => entry.place.column)
    )
    let column = 0
    while (taken.has(column)) column++
    const place: HourPlace<T> = { item, column, columns: 1 }
    cluster.push({ place, end })
    places.push(place)
    clusterEnd = Math.max(clusterEnd, end)
  }
  close()
  return places
}
