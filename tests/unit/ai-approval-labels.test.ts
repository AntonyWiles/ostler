import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AINextTaskApproval, Result, WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)
  }
}))

const { PlanningService } = await import('../../electron/services/planning-service')
const { registerPlanningHandlers } = await import('../../electron/ipc/planning-handlers')
const { IPC_CHANNELS } = await import('../../src/shared/ostler-api')

const PROJECT = 'project-one'
const DRAFT = 'draft-next-1'

// R1.3: an approved AI suggestion carries no internal label; its origin and
// the draft id in its history say where it came from.
describe('approving Ostler AI suggestions', () => {
  const tempDir = useTempDir('ostler-ai-approval-')
  let planning: InstanceType<typeof PlanningService>

  beforeEach(async () => {
    planning = new PlanningService(await createMigratedDatabase(tempDir()), () => [PROJECT])
    handlers.clear()
    registerPlanningHandlers({
      configStore: {} as never,
      database: {} as never,
      aiPlanningService: {
        getNextTasksDraft: () => ({
          draftId: DRAFT,
          projectId: PROJECT,
          sources: [],
          suggestions: [{ attachments: [] }, { attachments: [] }]
        })
      } as never,
      gitReader: {} as never,
      harnessService: {} as never,
      planningService: planning,
      getProject: () => ({ id: PROJECT, name: 'One', enabled: true }) as WatchedProject,
      queueWorkItemForHarness: vi.fn(),
      notifyHarnessState: vi.fn(),
      notifyPlanningChanged: vi.fn(),
      recordWorkItemSources: vi.fn(),
      recordWorkItemAttachments: vi.fn()
    })
  })

  afterEach(() => {
    planning.close()
  })

  const approval = (suggestionIndex: number, title: string): AINextTaskApproval => ({
    suggestionIndex,
    title,
    description: '',
    priority: 'medium',
    acceptanceCriteria: [],
    milestoneId: null,
    status: 'backlog'
  })

  const approve = async (approvals: AINextTaskApproval[]) =>
    (await handlers.get(IPC_CHANNELS.APPROVE_AI_NEXT_TASKS)!(
      {},
      PROJECT,
      DRAFT,
      approvals
    )) as Result<{ id: string; labels: string[]; origin: string }[]>

  it('adds Suggest tasks without an internal label, and finds them by origin and draft', async () => {
    const result = await approve([approval(0, 'First'), approval(1, 'Second')])
    if (!result.ok) throw new Error(result.error)
    expect(result.value.map((item) => item.labels)).toEqual([[], []])
    expect(result.value.every((item) => item.origin === 'ai-approved')).toBe(true)
    expect(
      planning
        .listWorkItemsFromDraft(PROJECT, DRAFT)
        .map((item) => item.id)
        .sort()
    ).toEqual(result.value.map((item) => item.id).sort())
    expect(planning.listProjectLabels(PROJECT)).toEqual([])
  })

  it('adds nothing the second time the same draft is approved', async () => {
    const first = await approve([approval(0, 'First')])
    const second = await approve([approval(0, 'First'), approval(1, 'Second')])
    if (!first.ok || !second.ok) throw new Error('approval failed')
    expect(second.value.map((item) => item.id)).toEqual(first.value.map((item) => item.id))
    expect(planning.listWorkItems(PROJECT)).toHaveLength(1)
  })
})
