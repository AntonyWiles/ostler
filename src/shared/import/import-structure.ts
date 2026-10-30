import type { CsvField } from '../ostler-api'
import type { ImportTaskDraft } from './import-plan'
import { t } from '../i18n'

/**
 * Subtasks and Waits on for an import (R4.2): the other tool's references,
 * resolved within the file and checked against the rules a task obeys in
 * Ostler, so the dry run says what the writer will do. A subtask nests at most
 * three levels deep and waits only on tasks under the same parent, and
 * nothing waits on itself, round in a loop. A reference that breaks a rule,
 * or names a row that is not in the file or not imported, is left out with a
 * warning on its row; it is never dropped silently.
 */

/** One row's references, as written. */
export interface ImportRowRefs {
  line: number
  title: string
  /** The values other rows may name this one by (its key, its id). */
  keys: string[]
  parent: string
  waitsOn: string[]
  blocks: string[]
}

/** How deep subtasks nest in Ostler (`PlanningService`). */
const MAX_DEPTH = 3

type Warn = (line: number, field: CsvField, message: string) => void

/**
 * Resolves `rows`' references among themselves, sets each draft's
 * `parentLine` and `waitsOnLines`, and returns the drafts in an order the
 * writer can create them in (a parent and what a task waits on first),
 * otherwise as in the file.
 */
export function resolveImportStructure(
  tasks: ImportTaskDraft[],
  rows: ImportRowRefs[],
  warn: Warn
): ImportTaskDraft[] {
  const byLine = new Map(tasks.map((task) => [task.line, task]))
  const byKey = new Map<string, number>()
  const byTitle = new Map<string, number[]>()
  for (const row of rows) {
    for (const key of row.keys) if (key && !byKey.has(key)) byKey.set(key, row.line)
    const title = row.title.toLowerCase()
    if (title) byTitle.set(title, [...(byTitle.get(title) ?? []), row.line])
  }

  /** A row a reference names: by key, then by title when only one row has it. */
  const find = (ref: string): number | 'missing' | 'ambiguous' => {
    const key = byKey.get(ref)
    if (key !== undefined) return key
    const titled = byTitle.get(ref.toLowerCase()) ?? []
    if (titled.length === 1) return titled[0]
    return titled.length > 1 ? 'ambiguous' : 'missing'
  }
  /** A cell's references: the whole cell when it names a row, else its comma-separated parts. */
  const refsIn = (cells: string[]): string[] =>
    cells.flatMap((cell) => {
      const text = cell.trim()
      if (!text) return []
      if (find(text) !== 'missing') return [text]
      return text
        .split(/[,;\n]/)
        .map((part) => part.trim())
        .filter(Boolean)
    })
  /** The line a reference resolves to, or a warning and null. */
  const target = (ref: string, from: ImportRowRefs, field: CsvField): number | null => {
    const found = find(ref)
    if (found === 'missing') {
      warn(from.line, field, t('data:csvImport.refNotInFile', { ref }))
      return null
    }
    if (found === 'ambiguous') {
      warn(from.line, field, t('data:csvImport.refAmbiguous', { ref }))
      return null
    }
    if (found === from.line) return null
    if (!byLine.has(found)) {
      warn(from.line, field, t('data:csvImport.refNotImported', { ref, line: found }))
      return null
    }
    return found
  }

  // Parents, in file order: one that closes a loop is left out.
  const parentOf = new Map<number, number>()
  const closesLoop = (line: number): boolean => {
    const seen = new Set([line])
    for (let at = parentOf.get(line); at !== undefined; at = parentOf.get(at)) {
      if (seen.has(at)) return true
      seen.add(at)
    }
    return false
  }
  const parentRef = new Map<number, string>()
  for (const row of rows) {
    if (!byLine.has(row.line) || !row.parent.trim()) continue
    const parent = target(row.parent.trim(), row, 'parent')
    if (parent === null) continue
    parentOf.set(row.line, parent)
    parentRef.set(row.line, row.parent.trim())
    if (closesLoop(row.line)) {
      parentOf.delete(row.line)
      warn(row.line, 'parent', t('data:csvImport.parentLoop', { ref: row.parent.trim() }))
    }
  }
  // A fourth level comes in as a task of its own, with its subtasks.
  const depths = new Map<number, number>()
  const depthOf = (line: number): number => {
    const known = depths.get(line)
    if (known !== undefined) return known
    const parent = parentOf.get(line)
    let depth = parent === undefined ? 1 : depthOf(parent) + 1
    if (depth > MAX_DEPTH) {
      parentOf.delete(line)
      warn(line, 'parent', t('data:csvImport.parentTooDeep', { ref: parentRef.get(line) ?? '' }))
      depth = 1
    }
    depths.set(line, depth)
    return depth
  }
  for (const row of rows) if (byLine.has(row.line)) depthOf(row.line)

  // Waits on: what a row names in its own column, and what names it as blocked.
  const edges: { from: ImportRowRefs; field: CsvField; before: number; after: number }[] = []
  for (const row of rows) {
    if (!byLine.has(row.line)) continue
    for (const ref of refsIn(row.waitsOn)) {
      const line = target(ref, row, 'waitsOn')
      if (line !== null) edges.push({ from: row, field: 'waitsOn', before: line, after: row.line })
    }
    for (const ref of refsIn(row.blocks)) {
      const line = target(ref, row, 'blocks')
      if (line !== null) edges.push({ from: row, field: 'blocks', before: row.line, after: line })
    }
  }
  const waitsOn = new Map<number, number[]>()
  /** Whether `from` must come before `to` already (a parent before its subtasks, a task before what waits on it). */
  const comesBefore = (from: number, to: number): boolean => {
    const stack = [to]
    const seen = new Set<number>()
    while (stack.length > 0) {
      const at = stack.pop()!
      if (at === from) return true
      if (seen.has(at)) continue
      seen.add(at)
      const parent = parentOf.get(at)
      if (parent !== undefined) stack.push(parent)
      stack.push(...(waitsOn.get(at) ?? []))
    }
    return false
  }
  for (const edge of edges) {
    const list = waitsOn.get(edge.after) ?? []
    if (list.includes(edge.before)) continue
    const title = byLine.get(edge.before === edge.from.line ? edge.after : edge.before)!.title
    // A subtask waits only on tasks under the same parent (a task of its own on anything).
    const parent = parentOf.get(edge.after)
    if (parent !== undefined && parent !== parentOf.get(edge.before)) {
      warn(edge.from.line, edge.field, t('data:csvImport.waitsOnNotSibling', { title }))
      continue
    }
    if (comesBefore(edge.after, edge.before)) {
      warn(edge.from.line, edge.field, t('data:csvImport.waitsOnLoop', { title }))
      continue
    }
    waitsOn.set(edge.after, [...list, edge.before])
  }

  for (const task of tasks) {
    const parent = parentOf.get(task.line)
    if (parent !== undefined) task.parentLine = parent
    const lines = waitsOn.get(task.line)
    if (lines) task.waitsOnLines = lines
  }

  // What must exist first comes first; otherwise the file's order.
  const ordered: ImportTaskDraft[] = []
  const placed = new Set<number>()
  const place = (task: ImportTaskDraft) => {
    if (placed.has(task.line)) return
    placed.add(task.line)
    const first = [
      ...(task.parentLine !== undefined ? [task.parentLine] : []),
      ...(task.waitsOnLines ?? [])
    ]
    for (const line of first) place(byLine.get(line)!)
    ordered.push(task)
  }
  for (const task of tasks) place(task)
  return ordered
}
