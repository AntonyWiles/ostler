// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningCard } from '@renderer/views/planning/PlanningCard'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import type { HarnessSession, PlanningWorkItem } from '@shared/ostler-api'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import type { ReactElement } from 'react'

const withAgents = (ui: ReactElement, ai = true) => (
  <StaticFeaturesProvider value={{ agents: true, ai }}>{ui}</StaticFeaturesProvider>
)

function workItem(overrides: Partial<PlanningWorkItem> = {}): PlanningWorkItem {
  return {
    id: 'wi-1',
    projectId: 'p1',
    title: 'Persist agent transcripts',
    description: '',
    status: 'ready',
    priority: 'medium',
    labels: [],
    acceptanceCriteria: [],
    checkedCriteria: [],
    dependencyIds: [],
    milestoneId: null,
    targetDate: null,
    startDate: null,
    assigneeId: null,
    estimate: null,
    autoQueue: false,
    linkedHarnessTaskId: null,
    createdAt: Date.now(),
    ...overrides
  } as unknown as PlanningWorkItem
}

let base: PlanningWorkspace

beforeEach(async () => {
  base = await renderPlanningWorkspace()
})

function workspace(overrides: Partial<PlanningWorkspace> = {}): PlanningWorkspace {
  return withWorkspace(base, overrides)
}

/** The card's one meta row: priority, due date, counts and marks. */
const metaRow = (container: HTMLElement) =>
  container.querySelector('.task-card__meta') as HTMLElement

const moreMenu = () => fireEvent.click(screen.getByRole('button', { name: /More actions/ }))

describe('PlanningCard meta row', () => {
  it('says how many dependencies are still open, and names them', () => {
    const blocker = workItem({ id: 'wi-2', title: 'Harness token rotation' })
    render(
      <PlanningCard
        item={workItem({ dependencyIds: ['wi-2', 'wi-3'] })}
        ws={workspace({ unmetDependencies: () => [blocker] })}
      />
    )
    const signal = screen.getByText('Waiting on 1').closest('span')!
    // The outstanding task is named on hover, so "what am I waiting for?"
    // does not need the drawer.
    expect(signal.getAttribute('title')).toContain('Harness token rotation')
  })

  it('says nothing about dependencies once they are all done', () => {
    render(
      <PlanningCard
        item={workItem({ dependencyIds: ['wi-2'] })}
        ws={workspace({ unmetDependencies: () => [] })}
      />
    )
    expect(screen.queryByText(/Waiting on/)).toBeNull()
  })

  it('shows an overdue due date in the meta row', () => {
    const { container } = render(
      <PlanningCard item={workItem({ targetDate: '2020-01-01' })} ws={workspace()} />
    )
    const due = within(metaRow(container))
      .getByText(/overdue/)
      .closest('.task-card__due')!
    expect(due.className).toContain('is-overdue')
    expect(due.getAttribute('title')).toMatch(/^Overdue by \d+ days/)
  })

  it('does not flag a finished task as overdue', () => {
    const { container } = render(
      <PlanningCard
        item={workItem({ targetDate: '2020-01-01', status: 'done' })}
        ws={workspace({ projectedStatus: () => 'done' })}
      />
    )
    const due = metaRow(container).querySelector('.task-card__due') as HTMLElement
    expect(due.className).toContain('is-plain')
    expect(within(due).queryByText(/overdue/)).toBeNull()
  })

  it('hides the priority icon for Medium and shows it otherwise', () => {
    const { rerender } = render(<PlanningCard item={workItem()} ws={workspace()} />)
    expect(screen.queryByRole('img', { name: /priority/ })).toBeNull()
    rerender(<PlanningCard item={workItem({ priority: 'high' })} ws={workspace()} />)
    expect(screen.getByRole('img', { name: 'High priority' })).toBeTruthy()
  })

  it('surfaces open blockers and subtasks', () => {
    render(
      <PlanningCard
        item={workItem()}
        subtaskCount={3}
        ws={workspace({ openBlockersByWorkItem: new Map([['wi-1', 2]]) })}
      />
    )
    expect(screen.getByText(/2 blockers/)).toBeTruthy()
    expect(screen.getByTitle('3 subtasks')).toBeTruthy()
  })

  it('shows its task type as a named icon, and nothing for none (N2.7a)', () => {
    const bug = {
      id: 'y1',
      projectId: 'p1',
      name: 'Bug',
      icon: 'bug',
      color: '#ef4444',
      position: 0,
      createdAt: 0,
      updatedAt: 0
    }
    const ws = workspace({
      taskTypes: [bug],
      taskTypeById: new Map([['y1', bug]])
    } as unknown as Partial<PlanningWorkspace>)
    const { rerender } = render(<PlanningCard item={workItem({ typeId: 'y1' })} ws={ws} />)
    expect(screen.getByLabelText('Type: Bug')).toBeTruthy()
    rerender(<PlanningCard item={workItem({ typeId: null })} ws={ws} />)
    expect(screen.queryByLabelText('Type: Bug')).toBeNull()
  })

  it('shows at most three labels, then how many more', () => {
    render(<PlanningCard item={workItem({ labels: ['a', 'b', 'c', 'd', 'e'] })} ws={workspace()} />)
    expect(screen.getByText('c')).toBeTruthy()
    expect(screen.queryByText('d')).toBeNull()
    expect(screen.getByText('+2')).toBeTruthy()
  })

  it('shows column age as a quiet clock with the time in its tooltip', () => {
    const twoDaysAgo = Date.now() - 2 * 86_400_000
    render(<PlanningCard item={workItem({ createdAt: twoDaysAgo })} ws={workspace()} />)
    expect(screen.getByRole('img', { name: /In this column for 2d/ })).toBeTruthy()
    // Not aged yet: no token beside the clock.
    expect(screen.queryByText('2d')).toBeNull()
  })

  it('adds the age token once a card has sat in its column for days', () => {
    const fourDaysAgo = Date.now() - 4 * 86_400_000
    render(<PlanningCard item={workItem({ createdAt: fourDaysAgo })} ws={workspace()} />)
    expect(screen.getByText('4d')).toBeTruthy()
  })
})

describe('PlanningCard actions', () => {
  it('shows only More, for the keyboard, and no selection box at rest', () => {
    render(<PlanningCard item={workItem()} ws={workspace()} onToggle={() => {}} />)
    const buttons = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))
    expect(buttons).toEqual(['More actions for Persist agent transcripts'])
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('shows the selection box when the Board asks for boxes, or something is selected', () => {
    const { rerender } = render(
      <PlanningCard item={workItem()} ws={workspace()} onToggle={() => {}} showBoxes />
    )
    expect(screen.getByRole('checkbox', { name: 'Select Persist agent transcripts' })).toBeTruthy()
    rerender(<PlanningCard item={workItem()} ws={workspace()} onToggle={() => {}} selecting />)
    expect(screen.getByRole('checkbox', { name: 'Select Persist agent transcripts' })).toBeTruthy()
  })

  it('opens the drawer with one click on the card, and from the menu', () => {
    const openWorkItem = vi.fn()
    const { container } = render(
      <PlanningCard item={workItem()} ws={workspace({ openWorkItem })} />
    )
    fireEvent.click(container.querySelector('.task-card__title')!)
    moreMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }))
    expect(openWorkItem).toHaveBeenCalledTimes(2)
  })

  it('selects with Ctrl and a click instead of opening', () => {
    const openWorkItem = vi.fn()
    const onToggle = vi.fn()
    const { container } = render(
      <PlanningCard item={workItem()} ws={workspace({ openWorkItem })} onToggle={onToggle} />
    )
    fireEvent.click(container.querySelector('.task-card__title')!, { ctrlKey: true })
    expect(onToggle).toHaveBeenCalledWith(true)
    expect(openWorkItem).not.toHaveBeenCalled()
  })

  it('offers the same actions on right-click', () => {
    const moveWorkItem = vi.fn()
    render(<PlanningCard item={workItem()} ws={workspace({ moveWorkItem })} />)
    fireEvent.contextMenu(screen.getByRole('article', { name: 'Persist agent transcripts' }))
    expect(screen.getByRole('menu', { name: 'Actions for Persist agent transcripts' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Done' }))
    expect(moveWorkItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'wi-1' }), 'done', null)
  })
})

describe('PlanningCard dragging', () => {
  const article = () => screen.getByRole('article', { name: 'Persist agent transcripts' })

  it('drags by the whole card', () => {
    const setDraggingWorkItemId = vi.fn()
    render(<PlanningCard item={workItem()} ws={workspace({ setDraggingWorkItemId })} />)
    expect(article()).toHaveAttribute('draggable', 'true')
    expect(article().className).toContain('is-draggable')
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' }
    fireEvent.dragStart(article(), { dataTransfer })
    expect(setDraggingWorkItemId).toHaveBeenCalledWith('wi-1')
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'wi-1')
  })

  it('is not draggable when the board may not move it', () => {
    render(<PlanningCard item={workItem()} ws={workspace({ busy: true })} />)
    expect(article()).not.toHaveAttribute('draggable')
  })

  it('edits no field from the card: its facts are text, and a click opens the drawer', () => {
    const openWorkItem = vi.fn()
    render(
      <PlanningCard
        item={workItem({ targetDate: '2099-03-04', priority: 'high', labels: ['Urgent'] })}
        ws={workspace({ openWorkItem })}
      />
    )
    expect(document.querySelector('button.task-card__due')).toBeNull()
    expect(document.querySelector('button.task-card__labels')).toBeNull()
    fireEvent.click(document.querySelector('.task-card__due')!)
    expect(openWorkItem).toHaveBeenCalledTimes(1)
  })

  it('renames in place with E, Enter saving and Esc putting it back', () => {
    const updateWorkItemInline = vi.fn().mockResolvedValue(true)
    render(<PlanningCard item={workItem()} ws={workspace({ updateWorkItemInline })} />)
    fireEvent.keyDown(article(), { key: 'e' })
    const field = screen.getByRole('textbox', { name: 'Title' })
    fireEvent.change(field, { target: { value: 'Keep agent transcripts' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(updateWorkItemInline).not.toHaveBeenCalled()

    fireEvent.keyDown(article(), { key: 'F2' })
    const again = screen.getByRole('textbox', { name: 'Title' })
    fireEvent.change(again, { target: { value: 'Keep agent transcripts' } })
    fireEvent.keyDown(again, { key: 'Enter' })
    expect(updateWorkItemInline).toHaveBeenCalledWith(expect.objectContaining({ id: 'wi-1' }), {
      title: 'Keep agent transcripts'
    })
  })
})

describe('PlanningCard agents', () => {
  const agent = (overrides: Partial<HarnessSession> = {}) =>
    ({
      id: 'sess-1',
      title: 'Agent one',
      status: 'active',
      blocked: false,
      provenance: 'embedded',
      lastUpdate: new Date().toISOString(),
      ...overrides
    }) as unknown as HarnessSession

  const linked = workItem({ status: 'active', linkedHarnessTaskId: 'task-1' })

  it('shows the Running pill and opens the run from the menu', () => {
    const setTranscriptSessionId = vi.fn()
    render(
      withAgents(
        <PlanningCard
          item={linked}
          ws={workspace({
            agentPillOf: () => 'running',
            sessionForWorkItem: () => agent(),
            setTranscriptSessionId
          })}
        />
      )
    )

    expect(screen.getByText('Running')).toBeTruthy()
    moreMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Watch agent run' }))

    expect(setTranscriptSessionId).toHaveBeenCalledWith('sess-1')
  })

  it('offers one contextual button when the agent asked a question', () => {
    const setTranscriptSessionId = vi.fn()
    render(
      withAgents(
        <PlanningCard
          item={linked}
          ws={workspace({
            sessionForWorkItem: () => agent({ blocked: true }),
            setTranscriptSessionId
          })}
        />
      )
    )

    fireEvent.click(screen.getByRole('button', { name: 'See what it needs' }))
    expect(setTranscriptSessionId).toHaveBeenCalledWith('sess-1')
  })

  it('offers Review changes when a finished run waits on a decision', () => {
    const setReviewSessionId = vi.fn()
    render(
      withAgents(
        <PlanningCard
          item={workItem({ status: 'review', linkedHarnessTaskId: 'task-1' })}
          ws={workspace({
            agentPillOf: () => 'review',
            reviewSessionForItem: () => agent({ id: 'sess-9', status: 'done' }),
            setReviewSessionId
          })}
        />
      )
    )

    expect(screen.getByText('Needs review')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }))
    expect(setReviewSessionId).toHaveBeenCalledWith('sess-9')
  })

  it('shows no agent pill, contextual button or agent menu item while agents are off', () => {
    render(
      <PlanningCard
        item={linked}
        ws={workspace({
          agentPillOf: () => 'running',
          sessionForWorkItem: () => agent({ blocked: true }),
          reviewSessionForItem: () => agent(),
          queuePositionOf: () => 0
        })}
      />
    )

    expect(screen.queryByText('Running')).toBeNull()
    expect(screen.queryByRole('button', { name: 'See what it needs' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Review changes' })).toBeNull()
    moreMenu()
    for (const name of ['Queue for agent', 'Run now', 'Copy agent prompt', 'Watch agent run']) {
      expect(screen.queryByRole('menuitem', { name })).toBeNull()
    }
    expect(screen.queryByRole('menuitem', { name: 'Edit with AI' })).toBeNull()
  })

  it('keeps Queue for agent and Edit with AI in the More menu when both are on', () => {
    const queueWorkItem = vi.fn()
    render(
      withAgents(
        <PlanningCard item={workItem({ status: 'ready' })} ws={workspace({ queueWorkItem })} />
      )
    )

    expect(screen.queryByRole('button', { name: 'Queue for agent' })).toBeNull()
    moreMenu()
    expect(screen.getByRole('menuitem', { name: 'Edit with AI' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Queue for agent' }))
    expect(queueWorkItem).toHaveBeenCalled()
  })
})

describe('PlanningCard custom fields (R2.2)', () => {
  const fields = [
    {
      id: 'f-size',
      projectId: 'p1',
      name: 'Size',
      type: 'choice' as const,
      options: [{ id: 'o-s', name: 'Small', color: '#888888' }],
      position: 0,
      createdAt: 0
    },
    {
      id: 'f-cost',
      projectId: 'p1',
      name: 'Cost',
      type: 'number' as const,
      options: [],
      position: 1,
      createdAt: 0
    }
  ]

  it('shows no fields until the person chooses some', () => {
    const { container } = render(
      <PlanningCard
        item={workItem({ fieldValues: { 'f-size': 'o-s' } })}
        ws={workspace({ fields, boardCardFields: [] })}
      />
    )
    expect(container.querySelector('.task-card__fields')).toBeNull()
  })

  it('shows the chosen fields that have a value, in the chosen order', () => {
    const { container } = render(
      <PlanningCard
        item={workItem({ fieldValues: { 'f-size': 'o-s', 'f-cost': 12 } })}
        ws={workspace({ fields, boardCardFields: ['f-cost', 'f-size'] })}
      />
    )
    const terms = [...container.querySelectorAll('.task-card__field dt')].map((n) => n.textContent)
    expect(terms).toEqual(['Cost', 'Size'])
    expect(screen.getByText('Small')).toBeTruthy()
  })
})
