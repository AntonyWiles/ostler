/**
 * The P9.1 performance budgets, as `docs/performance.md` states them. The perf
 * suite judges every measure against its budget here and writes the result to
 * test-results/perf.json.
 */
export const BUDGETS = {
  coldStart: { label: 'Cold start to Home', budget: 2_500, unit: 'ms' },
  projectSwitch: { label: 'Project switch (slowest)', budget: 300, unit: 'ms' },
  viewSwitch: { label: 'View switch (slowest)', budget: 300, unit: 'ms' },
  myWorkOpen: { label: 'My work open, busiest person (slowest)', budget: 300, unit: 'ms' },
  workloadOpen: { label: 'Workload open, every project (slowest)', budget: 300, unit: 'ms' },
  timelineOverviewOpen: {
    label: 'Timeline across projects open, every project (slowest)',
    budget: 300,
    unit: 'ms'
  },
  boardRender: { label: 'Board, 500 cards: render', budget: 500, unit: 'ms' },
  boardDragLongTask: {
    label: 'Board, 500 cards: longest task while dragging',
    budget: 50,
    unit: 'ms'
  },
  listScrollLongTask: {
    label: 'List, 5,000 rows: longest task while scrolling',
    budget: 50,
    unit: 'ms'
  },
  whiteboardOpen: { label: 'Whiteboard, 2,000 objects: open', budget: 1_000, unit: 'ms' },
  whiteboardDragLongTask: {
    label: 'Whiteboard, 2,000 objects: longest task while dragging one object',
    budget: 50,
    unit: 'ms'
  },
  search: { label: 'Search (slowest query)', budget: 150, unit: 'ms' },
  idleCpu: { label: 'Idle, agents off: average CPU', budget: 1, unit: '%' },
  idleMemory: { label: 'Idle, agents off: total private memory', budget: 400, unit: 'MB' },
  idleIpc: { label: 'Idle IPC calls per minute, one open project', budget: 1, unit: 'calls/min' }
} as const

export type BudgetId = keyof typeof BUDGETS

export interface Measure {
  id: BudgetId
  label: string
  value: number
  unit: string
  budget: number
  passed: boolean
  detail?: Record<string, unknown>
}

export interface PerfReport {
  measuredAt: string
  machine: { cpu: string; cores: number; memoryGb: number; os: string }
  dataset: string
  idleMinutes: number
  measures: Measure[]
  /** Findings with no budget: the listener and heap audit after 50 view switches. */
  audits: Record<string, unknown>
  passed: boolean
}

/** A measure against its budget. "No long task over 50 ms" means at most 50. */
export function judge(id: BudgetId, value: number, detail?: Record<string, unknown>): Measure {
  const { label, budget, unit } = BUDGETS[id]
  const rounded = Math.round(value * 100) / 100
  return { id, label, value: rounded, unit, budget, passed: rounded <= budget, detail }
}
