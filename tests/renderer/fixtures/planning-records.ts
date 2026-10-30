import type {
  HarnessProjectState,
  HarnessSession,
  HarnessTask,
  PlanningWorkItem
} from '@shared/ostler-api'

/** A complete work item with sensible defaults; pass only what a case cares about. */
export function makeWorkItem(
  id: string,
  overrides: Partial<PlanningWorkItem> = {}
): PlanningWorkItem {
  return {
    id,
    projectId: 'p1',
    milestoneId: null,
    title: `Item ${id}`,
    description: '',
    status: 'backlog',
    priority: 'medium',
    labels: [],
    acceptanceCriteria: [],
    dependencyIds: [],
    targetDate: null,
    startDate: null,
    assigneeId: null,
    estimate: null,
    checkedCriteria: [],
    origin: 'human',
    linkedHarnessTaskId: null,
    autoQueue: false,
    parentWorkItemId: null,
    taskCode: '',
    phaseCode: '',
    phaseName: '',
    subtaskPhaseNumber: null,
    subtaskPhaseName: '',
    verificationStatus: 'unverified',
    verifiedBy: null,
    verifiedAt: null,
    verificationNotes: '',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides
  }
}

export function makeTask(id: string, overrides: Partial<HarnessTask> = {}): HarnessTask {
  return {
    id,
    title: `Task ${id}`,
    status: 'pending',
    claimedBy: null,
    details: '',
    priority: 'medium',
    planningWorkItemId: null,
    autoContinue: false,
    ...overrides
  }
}

export function makeSession(id: string, overrides: Partial<HarnessSession> = {}): HarnessSession {
  return {
    id,
    title: `Session ${id}`,
    startedAt: '2026-10-01T00:00:00.000Z',
    lastUpdate: '2026-10-01T00:00:00.000Z',
    statusNote: '',
    status: 'active',
    blocked: false,
    workspace: null,
    token: '',
    lastSeenAt: null,
    provenance: 'external',
    ...overrides
  } as HarnessSession
}

export function makeHarnessState(
  overrides: Partial<HarnessProjectState> = {}
): HarnessProjectState {
  return {
    projectId: 'p1',
    hasHarness: true,
    activeSessions: [],
    reviewSessions: [],
    taskQueue: [],
    questions: [],
    watcherRunning: true,
    ...overrides
  }
}

/**
 * One board covering every rule the planning workspace derives: each harness
 * task state, met and unmet dependencies, queue order and queue waiting, and
 * enough variety in priority, dates and titles to sort on.
 */
export function planningScenario(): { items: PlanningWorkItem[]; harness: HarnessProjectState } {
  const reviewSession = makeSession('s-review', { status: 'done', taskId: 't-i' })
  const startingSession = makeSession('s-start', { taskId: 't-f' })
  const items = [
    makeWorkItem('a', { title: 'Alpha', priority: 'low', createdAt: 5, labels: ['ui'] }),
    makeWorkItem('b', {
      title: 'Bravo',
      status: 'ready',
      priority: 'high',
      dependencyIds: ['a'],
      targetDate: '2026-12-01',
      createdAt: 3
    }),
    makeWorkItem('c', { title: 'Charlie', status: 'done', createdAt: 9 }),
    makeWorkItem('d', {
      title: 'Delta',
      status: 'ready',
      dependencyIds: ['c'],
      targetDate: '2026-11-01',
      createdAt: 1,
      milestoneId: 'm1'
    }),
    makeWorkItem('e', { title: 'Echo', status: 'active', linkedHarnessTaskId: 't-e' }),
    makeWorkItem('f', { title: 'Foxtrot', status: 'active', linkedHarnessTaskId: 't-f' }),
    makeWorkItem('g', { title: 'Golf', status: 'active', linkedHarnessTaskId: 't-g' }),
    makeWorkItem('h', {
      title: 'Hotel',
      status: 'active',
      priority: 'critical',
      linkedHarnessTaskId: 't-h'
    }),
    makeWorkItem('i', { title: 'India', status: 'active', linkedHarnessTaskId: 't-i' }),
    makeWorkItem('j', { title: 'Juliet', status: 'active', linkedHarnessTaskId: 't-j' }),
    makeWorkItem('k', { title: 'Kilo', status: 'active', linkedHarnessTaskId: 't-k' }),
    makeWorkItem('l', { title: 'Lima', status: 'active', linkedHarnessTaskId: 't-missing' }),
    makeWorkItem('m', {
      title: 'Mike',
      status: 'active',
      linkedHarnessTaskId: 't-m',
      dependencyIds: ['b']
    }),
    makeWorkItem('n', { title: 'November', status: 'ready', dependencyIds: ['j'] }),
    makeWorkItem('o', {
      title: 'Oscar',
      status: 'ready',
      dependencyIds: ['i', 'missing-item'],
      milestoneId: 'm1'
    }),
    makeWorkItem('p', { title: 'Papa', status: 'blocked', description: 'needs a UI decision' }),
    makeWorkItem('q', { title: 'Quebec', status: 'active', linkedHarnessTaskId: 't-q' }),
    makeWorkItem('r', {
      title: 'Romeo',
      status: 'ready',
      parentWorkItemId: 'a',
      dependencyIds: ['a']
    })
  ]
  const harness = makeHarnessState({
    activeSessions: [startingSession],
    reviewSessions: [reviewSession],
    taskQueue: [
      makeTask('t-e', { planningWorkItemId: 'e' }),
      makeTask('t-f', {
        planningWorkItemId: 'f',
        copy: {
          state: 'preparing',
          preparedAt: '2026-01-01T00:00:00.000Z',
          hasWork: false,
          branchName: 'ostler/t',
          worktreePath: '/copies/t',
          baseBranch: 'main',
          baseCommit: 'abc'
        }
      }),
      makeTask('t-g', { planningWorkItemId: 'g', hold: true }),
      makeTask('t-h', { planningWorkItemId: 'h', status: 'claimed', claimedBy: 's-other' }),
      makeTask('t-i', { planningWorkItemId: 'i', status: 'complete', claimedBy: 's-review' }),
      makeTask('t-j', { planningWorkItemId: 'j', status: 'complete', claimedBy: 's-gone' }),
      makeTask('t-k', { planningWorkItemId: 'k', status: 'cancelled' }),
      makeTask('t-m', { planningWorkItemId: 'm', waitingOnDependencies: 2 }),
      makeTask('t-q', { planningWorkItemId: 'q' })
    ]
  })
  return { items, harness }
}

/** What the scenario's rules produce. Written down from the hook before it was split. */
export const SCENARIO_EXPECTED = {
  projectedStatus: {
    a: 'backlog',
    b: 'ready',
    c: 'done',
    d: 'ready',
    e: 'ready',
    f: 'active',
    g: 'blocked',
    h: 'active',
    i: 'review',
    j: 'done',
    k: 'ready',
    l: 'ready',
    m: 'ready',
    n: 'ready',
    o: 'ready',
    p: 'blocked',
    q: 'ready',
    r: 'ready'
  },
  executionLabel: {
    a: null,
    e: 'Queued',
    f: 'Getting ready',
    g: 'Held — no agent will take it',
    h: 'Running',
    i: 'In review',
    j: 'Accepted',
    k: 'Cancelled — Ready to requeue',
    l: 'Preparing queue',
    m: 'Queued',
    q: 'Queued'
  },
  unmetDependencies: {
    a: [],
    b: ['a'],
    d: [],
    m: ['b'],
    n: [],
    o: ['i'],
    // A parent never blocks its own subtask: main always said so, the Board now agrees.
    r: []
  },
  queuePosition: { a: -1, e: 0, f: -1, g: -1, m: -1, q: 1, k: -1 },
  queueWait: { e: 0, m: 2, q: 0, a: 0 },
  readyNow: ['b', 'd', 'n', 'o', 'r'],
  activeNow: ['f', 'h'],
  blockedNow: ['g', 'p'],
  runnableTasks: ['t-e', 't-q'],
  waitingTasks: ['t-m']
} as const
