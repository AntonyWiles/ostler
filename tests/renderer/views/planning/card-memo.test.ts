import { describe, expect, it, vi } from 'vitest'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { CARD_WORKSPACE_INPUTS, cardPropsEqual } from '@renderer/views/planning/card-memo'
import { makeWorkItem } from '../../fixtures/planning-records'

const ws = (overrides: Record<string, unknown> = {}) =>
  ({
    projectId: 'p1',
    busy: false,
    workItems: [],
    milestones: [],
    goals: [],
    harnessState: null,
    lastStatusChangeAt: new Map(),
    openBlockersByWorkItem: new Map(),
    changedSourceWorkItemIds: new Set(),
    attachmentCounts: {},
    commentCounts: {},
    labelColor: vi.fn(),
    workspaceSlotsFull: false,
    projectedStatus: vi.fn(),
    dragOverStatus: null,
    ...overrides
  }) as unknown as PlanningWorkspace

describe('Board card memoisation keys (P9.1)', () => {
  const item = makeWorkItem('w1')
  const base = ws()
  const props = { item, ws: base, selected: false, selecting: false, focused: false }

  it('skips a render when only the workspace object or drag-over state changed', () => {
    const next = { ...base, dragOverStatus: 'ready', dragOverLaneId: 'x' } as PlanningWorkspace
    expect(cardPropsEqual(props, { ...props, ws: next, onToggle: () => {} })).toBe(true)
  })

  it('renders when its own props change', () => {
    expect(cardPropsEqual(props, { ...props, item: { ...item } })).toBe(false)
    expect(cardPropsEqual(props, { ...props, selected: true })).toBe(false)
    expect(cardPropsEqual(props, { ...props, focused: true })).toBe(false)
    expect(cardPropsEqual(props, { ...props, dragging: true })).toBe(false)
    expect(cardPropsEqual(props, { ...props, subtaskCount: 2 })).toBe(false)
  })

  it.each(CARD_WORKSPACE_INPUTS)('renders when the workspace %s changes', (key) => {
    const changed = { ...base, [key]: Symbol(key) } as unknown as PlanningWorkspace
    expect(cardPropsEqual(props, { ...props, ws: changed })).toBe(false)
  })
})
