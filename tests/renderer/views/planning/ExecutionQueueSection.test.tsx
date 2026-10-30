// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExecutionQueueSection } from '@renderer/views/planning/ExecutionQueueSection'
import type { HarnessProjectState, HarnessSession, HarnessTask } from '@shared/ostler-api'
import { RENDERER_DEFAULT_CONFIG, installOstlerApi } from '../../fixtures/ostler-api'
import { ConfirmProvider } from '@renderer/ui'

function task(id: string, title: string, status: HarnessTask['status']): HarnessTask {
  return {
    id,
    title,
    details: '',
    status,
    priority: 'medium',
    claimedBy: null,
    createdAt: Date.now(),
    planningWorkItemId: null
  } as unknown as HarnessTask
}

function session(id: string, title: string): HarnessSession {
  return {
    id,
    title,
    status: 'active',
    blocked: false,
    provenance: 'embedded',
    startedAt: new Date().toISOString(),
    lastUpdate: new Date().toISOString(),
    statusNote: '',
    workspace: null,
    token: 'tok',
    lastSeenAt: null
  } as unknown as HarnessSession
}

function harnessState(
  tasks: HarnessTask[],
  sessions: HarnessSession[] = [],
  reviews: HarnessSession[] = []
): HarnessProjectState {
  return {
    projectId: 'p1',
    hasHarness: true,
    activeSessions: sessions,
    reviewSessions: reviews,
    taskQueue: tasks,
    questions: [],
    watcherRunning: true
  } as unknown as HarnessProjectState
}

function renderQueue(
  tasks: HarnessTask[],
  extra: {
    sessions?: HarnessSession[]
    reviews?: HarnessSession[]
    openSessionTranscript?: (sessionId: string) => void
  } = {}
) {
  installOstlerApi({
    getProjectAutoDispatchConfig: async () => ({ ok: false, error: 'not configured' })
  })
  return render(
    <ExecutionQueueSection
      id="p1"
      openSessionTranscript={extra.openSessionTranscript}
      harnessState={harnessState(tasks, extra.sessions, extra.reviews)}
      reviewSessions={extra.reviews ?? []}
      runnableHarnessTasks={tasks.filter((t) => t.status === 'pending')}
      planningWorkItems={[]}
      planningMilestones={[]}
      harnessBusy={false}
      openPlanningTask={vi.fn()}
      copyPlanningTaskHandoff={vi.fn()}
      startSandboxedSession={vi.fn()}
      startEmbeddedSession={vi.fn()}
      nudgeHarnessTask={vi.fn()}
      toggleHarnessTaskAutoContinue={vi.fn()}
      changeHarnessTaskPriority={vi.fn()}
      cancelHarnessTask={vi.fn()}
      resumeSessionPrompt={vi.fn()}
      runHarnessAction={vi.fn()}
      persistHarnessQueueOrder={vi.fn()}
    />
  )
}

const MIXED = [
  task('t1', 'Still queued work', 'pending'),
  task('t2', 'Finished work', 'complete'),
  task('t3', 'Also finished', 'complete')
]

describe('ExecutionQueueSection scheduled tasks (N9.7)', () => {
  it('says "Scheduled" on a task its repeat queued, and nothing on one queued by hand', () => {
    renderQueue([
      { ...task('t1', 'Update the dependencies', 'pending'), scheduled: true },
      task('t2', 'Fix the login', 'pending')
    ])
    expect(screen.getAllByText('Scheduled')).toHaveLength(1)
  })
})

describe('ExecutionQueueSection completed tasks', () => {
  it('hides completed tasks by default', () => {
    renderQueue(MIXED)
    expect(screen.getByText('Still queued work')).toBeTruthy()
    expect(screen.queryByText('Finished work')).toBeNull()
    expect(screen.queryByText('Also finished')).toBeNull()
  })

  it('shows them once "Include accepted" is ticked', () => {
    renderQueue(MIXED)
    fireEvent.click(screen.getByRole('checkbox', { name: /Include accepted/ }))
    expect(screen.getByText('Finished work')).toBeTruthy()
    expect(screen.getByText('Also finished')).toBeTruthy()
  })

  it('counts the hidden completed tasks on the toggle', () => {
    renderQueue(MIXED)
    expect(screen.getByText('Include accepted (2)')).toBeTruthy()
  })

  it('still shows accepted tasks when the Accepted state is selected outright', () => {
    renderQueue(MIXED)
    fireEvent.click(screen.getByRole('button', { name: /Accepted/ }))
    expect(screen.getByText('Finished work')).toBeTruthy()
    expect(screen.queryByText('Still queued work')).toBeNull()
  })

  it('counts the Open chip by what selecting it would show', () => {
    renderQueue(MIXED)
    const openChip = screen.getByRole('button', { name: /Open/ })
    // One runnable task, not all three.
    expect(openChip.textContent).toContain('1')
  })

  it('explains an all-complete queue instead of blaming the filters', () => {
    renderQueue([task('t2', 'Finished work', 'complete')])
    expect(screen.getByText(/Nothing left to run/)).toBeTruthy()
    expect(screen.getByText(/1 accepted agent run is hidden/)).toBeTruthy()
  })

  it('calls a run whose work waits for review In review, shows it, and does not count it as accepted', () => {
    const reviewed = {
      ...task('t5', 'Waiting work', 'complete'),
      claimedBy: 'sess-5'
    } as HarnessTask
    const review = {
      ...session('sess-5', 'Agent five'),
      status: 'done',
      taskId: 't5'
    } as HarnessSession
    renderQueue([...MIXED, reviewed], { reviews: [review] })
    const row = screen.getByText('Waiting work').closest('li')!
    expect(within(row).getByText('In review')).toBeTruthy()
    expect(within(row).queryByText(/Complete|Accepted/)).toBeNull()
    expect(screen.getByText('Include accepted (2)')).toBeTruthy()
  })

  it('leaves cancelled tasks visible', () => {
    renderQueue([task('t4', 'Abandoned work', 'cancelled')])
    expect(screen.getByText('Abandoned work')).toBeTruthy()
  })
})

describe('ExecutionQueueSection transcript access', () => {
  const running = (() => {
    const claimed = task('t9', 'Work underway', 'claimed')
    return { ...claimed, claimedBy: 'sess-1' } as HarnessTask
  })()

  it('offers the live transcript while the agent is still working', () => {
    const openSessionTranscript = vi.fn()
    renderQueue([running], {
      sessions: [session('sess-1', 'Agent one')],
      openSessionTranscript
    })

    fireEvent.click(screen.getByRole('button', { name: /Watch live/ }))

    expect(openSessionTranscript).toHaveBeenCalledWith('sess-1')
  })

  it('says nothing about a transcript for a task no session owns', () => {
    renderQueue([task('t1', 'Still queued work', 'pending')], {
      openSessionTranscript: vi.fn()
    })

    expect(screen.queryByRole('button', { name: /Watch live/ })).toBeNull()
  })
})

describe('ExecutionQueueSection row actions', () => {
  it("says when the agent's copy could not be made, with the reason on hover", () => {
    const queued = {
      ...task('t9', 'Work waiting', 'pending'),
      copy: {
        state: 'failed',
        baseBranch: 'main',
        baseCommit: 'abc',
        branchName: 'ostler/t9-work-waiting',
        worktreePath: 'C:/copies/t9',
        hasWork: false,
        preparedAt: '2026-01-01T00:00:00.000Z',
        failure: 'disk full'
      }
    } as HarnessTask
    installOstlerApi({
      getProjectAutoDispatchConfig: async () => ({ ok: false, error: 'not configured' })
    })
    render(
      <ConfirmProvider>
        <ExecutionQueueSection
          id="p1"
          harnessState={harnessState([queued], [])}
          reviewSessions={[]}
          runnableHarnessTasks={[]}
          planningWorkItems={[]}
          planningMilestones={[]}
          harnessBusy={false}
          openPlanningTask={vi.fn()}
          copyPlanningTaskHandoff={vi.fn()}
          startSandboxedSession={vi.fn()}
          startEmbeddedSession={vi.fn()}
          nudgeHarnessTask={vi.fn()}
          toggleHarnessTaskAutoContinue={vi.fn()}
          changeHarnessTaskPriority={vi.fn()}
          cancelHarnessTask={vi.fn()}
          resumeSessionPrompt={vi.fn()}
          runHarnessAction={async (action) => (await action()).ok}
          persistHarnessQueueOrder={vi.fn()}
        />
      </ConfirmProvider>
    )

    expect(screen.getByText("Couldn't make the agent's copy. It will try again.")).toHaveAttribute(
      'title',
      'disk full'
    )
  })

  it('reorders queued runs with named buttons the keyboard can reach', () => {
    const queued = [task('t1', 'First run', 'pending'), task('t2', 'Second run', 'pending')]
    const nudgeHarnessTask = vi.fn()
    installOstlerApi({
      getProjectAutoDispatchConfig: async () => ({ ok: false, error: 'not configured' })
    })
    render(
      <ExecutionQueueSection
        id="p1"
        harnessState={harnessState(queued)}
        reviewSessions={[]}
        runnableHarnessTasks={queued}
        planningWorkItems={[]}
        planningMilestones={[]}
        harnessBusy={false}
        openPlanningTask={vi.fn()}
        copyPlanningTaskHandoff={vi.fn()}
        startSandboxedSession={vi.fn()}
        startEmbeddedSession={vi.fn()}
        nudgeHarnessTask={nudgeHarnessTask}
        toggleHarnessTaskAutoContinue={vi.fn()}
        changeHarnessTaskPriority={vi.fn()}
        cancelHarnessTask={vi.fn()}
        resumeSessionPrompt={vi.fn()}
        runHarnessAction={vi.fn()}
        persistHarnessQueueOrder={vi.fn()}
      />
    )
    const order = screen.getByRole('group', { name: 'Order of Second run' })
    const earlier = within(order).getByRole('button', { name: 'Move Second run earlier' })
    expect(earlier.tagName).toBe('BUTTON')
    expect(earlier).not.toBeDisabled()
    fireEvent.click(earlier)
    expect(nudgeHarnessTask).toHaveBeenCalledWith('t2', -1)
    expect(within(order).getByRole('button', { name: 'Move Second run later' })).toBeDisabled()
  })
})

describe('ExecutionQueueSection run models (D42)', () => {
  function renderWithSettings(tasks: HarnessTask[], sessions: HarnessSession[] = []) {
    installOstlerApi({
      getConfig: async () => ({
        ok: true,
        value: {
          ...RENDERER_DEFAULT_CONFIG,
          ai: { ...RENDERER_DEFAULT_CONFIG.ai, provider: 'anthropic', model: 'claude-sonnet-5-5' }
        }
      }),
      getProjectAutoDispatchConfig: async () => ({
        ok: true,
        value: {
          projectId: 'p1',
          enabled: false,
          maxConcurrentEmbeddedSessions: 0,
          aiOverrideEnabled: true,
          defaultProvider: 'anthropic',
          defaultModel: 'claude-opus-5-5',
          defaultEffort: '',
          autoArchiveDoneAfterDays: 0
        }
      })
    })
    const chooseRunModel = vi.fn()
    render(
      <ConfirmProvider>
        <ExecutionQueueSection
          id="p1"
          harnessState={harnessState(tasks, sessions)}
          reviewSessions={[]}
          runnableHarnessTasks={tasks.filter((t) => t.status === 'pending')}
          planningWorkItems={[]}
          planningMilestones={[]}
          harnessBusy={false}
          openPlanningTask={vi.fn()}
          copyPlanningTaskHandoff={vi.fn()}
          startSandboxedSession={vi.fn()}
          startEmbeddedSession={vi.fn()}
          nudgeHarnessTask={vi.fn()}
          toggleHarnessTaskAutoContinue={vi.fn()}
          changeHarnessTaskPriority={vi.fn()}
          cancelHarnessTask={vi.fn()}
          resumeSessionPrompt={vi.fn()}
          runHarnessAction={vi.fn()}
          persistHarnessQueueOrder={vi.fn()}
          chooseRunModel={chooseRunModel}
        />
      </ConfirmProvider>
    )
    return chooseRunModel
  }

  it("names a queued task's model: its own, else the project default", async () => {
    renderWithSettings([
      { ...task('t1', 'Rename a file', 'pending'), model: 'claude-haiku-5-5', effort: 'low' },
      task('t2', 'Build the feature', 'pending')
    ])
    expect(await screen.findByText('Model: claude-haiku-5-5, Low effort (this run)')).toBeTruthy()
    expect(screen.getByText('Model: claude-opus-5-5 (project default)')).toBeTruthy()
  })

  it('says an external agent runs on the model set in that agent, and names what an embedded run used', async () => {
    const external = { ...session('s1', 'Connected agent'), provenance: 'external' as const }
    const embedded = {
      ...session('s2', 'Built-in agent'),
      taskId: 't2',
      embeddedRuntime: { kind: 'opencode', model: 'claude-haiku-5-5' }
    } as unknown as HarnessSession
    renderWithSettings(
      [
        { ...task('t1', 'External work', 'claimed'), claimedBy: 's1' },
        { ...task('t2', 'Embedded work', 'claimed'), claimedBy: 's2' }
      ],
      [{ ...external, taskId: 't1' } as HarnessSession, embedded]
    )
    expect(await screen.findByText('Model: set in the connected agent')).toBeTruthy()
    expect(screen.getByText('Model: claude-haiku-5-5')).toBeTruthy()
  })
})

describe('ExecutionQueueSection Clear queue', () => {
  it('says the tasks stay in Ready and are queued again while agents are on', async () => {
    installOstlerApi({
      getProjectAutoDispatchConfig: async () => ({ ok: false, error: 'not configured' })
    })
    const tasks = [task('t1', 'One', 'pending'), task('t2', 'Two', 'pending')]
    const cancelHarnessTask = vi.fn()
    render(
      <ConfirmProvider>
        <ExecutionQueueSection
          id="p1"
          harnessState={harnessState(tasks)}
          reviewSessions={[]}
          runnableHarnessTasks={tasks}
          planningWorkItems={[]}
          planningMilestones={[]}
          harnessBusy={false}
          openPlanningTask={vi.fn()}
          copyPlanningTaskHandoff={vi.fn()}
          startSandboxedSession={vi.fn()}
          startEmbeddedSession={vi.fn()}
          nudgeHarnessTask={vi.fn()}
          toggleHarnessTaskAutoContinue={vi.fn()}
          changeHarnessTaskPriority={vi.fn()}
          cancelHarnessTask={cancelHarnessTask}
          resumeSessionPrompt={vi.fn()}
          runHarnessAction={vi.fn()}
          persistHarnessQueueOrder={vi.fn()}
        />
      </ConfirmProvider>
    )
    const clear = screen.getByRole('button', { name: 'Clear queue' })
    expect(clear).toHaveAttribute(
      'title',
      'Cancel every queued agent run. Their tasks stay in Ready, so while agents are on they are queued again straight away.'
    )
    fireEvent.click(clear)
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Cancel all 2 queued agent runs?'
    })
    expect(dialog).toHaveTextContent(
      'Their history is kept, and their tasks stay in Ready. While agents are on, every task in Ready is queued, so they are queued again straight away. To keep one waiting, put it on hold instead.'
    )
    expect(cancelHarnessTask).not.toHaveBeenCalled()
  })
})
