import { describe, expect, it } from 'vitest'
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_HINTS,
  TASK_STATUS_LABELS,
  taskPriorityLabel,
  taskStatusLabel
} from '../../src/shared/task-labels'
import { COLUMNS } from '../../src/renderer/hooks/planning/columns'

describe('task labels', () => {
  it('has a label and a hint for every status', () => {
    expect(Object.keys(TASK_STATUS_LABELS).sort()).toEqual([...TASK_STATUSES].sort())
    for (const status of TASK_STATUSES) {
      expect(taskStatusLabel(status)).toBe(TASK_STATUS_LABELS[status])
      expect(TASK_STATUS_LABELS[status]).toMatch(/\S/)
      expect(TASK_STATUS_HINTS[status]).toMatch(/\S/)
    }
  })

  it('uses the glossary words', () => {
    expect(taskStatusLabel('active')).toBe('In progress')
    expect(taskStatusLabel('review')).toBe('In review')
  })

  it('has a label for every priority', () => {
    expect(Object.keys(TASK_PRIORITY_LABELS).sort()).toEqual([...TASK_PRIORITIES].sort())
    for (const priority of TASK_PRIORITIES) {
      expect(taskPriorityLabel(priority)).toBe(TASK_PRIORITY_LABELS[priority])
      expect(TASK_PRIORITY_LABELS[priority]).toMatch(/\S/)
    }
  })

  it('gives the Board one column per status, in order, reading the shared words', () => {
    expect(COLUMNS.map((column) => column.status)).toEqual([...TASK_STATUSES])
    for (const column of COLUMNS) {
      expect(column.label).toBe(TASK_STATUS_LABELS[column.status])
      expect(column.hint).toBe(TASK_STATUS_HINTS[column.status])
    }
  })
})
