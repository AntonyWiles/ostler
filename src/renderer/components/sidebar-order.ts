/** The sidebar's project order after moving one project by `delta` places. */
export function moveProject(ids: readonly string[], id: string, delta: number): string[] {
  const from = ids.indexOf(id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= ids.length) return [...ids]
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}

/** The order after dropping `draggedId` onto `targetId`'s place. */
export function dropProject(ids: readonly string[], draggedId: string, targetId: string): string[] {
  const to = ids.indexOf(targetId)
  if (draggedId === targetId || to < 0 || !ids.includes(draggedId)) return [...ids]
  return moveProject(ids, draggedId, to - ids.indexOf(draggedId))
}
