// @vitest-environment jsdom
import { useState } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AINextTasksModal } from '@renderer/views/planning/AINextTasksModal'
import { AiBreakdownDialog } from '@renderer/views/planning/AiBreakdownDialog'
import type { NextTaskReviewItem } from '@renderer/views/project-detail/types'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import type { AINextTasksDraft, AIPlanningDraft, AIPlanningSuggestion } from '@shared/ostler-api'
import { installOstlerApi } from '../fixtures/ostler-api'

const suggestion = (n: number): AIPlanningSuggestion => ({
  title: `Draft ${n}`,
  description: `Details ${n}`,
  priority: 'medium',
  acceptanceCriteria: [],
  rationale: '',
  evidence: [],
  attachments: []
})

const SUGGESTIONS = [1, 2, 3].map(suggestion)

const draftBase = {
  schemaVersion: 1 as const,
  promptVersion: 1,
  projectId: 'p1',
  generatedAt: '2026-10-11T10:00:00.000Z',
  provider: 'custom' as const,
  model: 'test-model',
  summary: '',
  assumptions: [],
  warnings: [],
  suggestions: SUGGESTIONS
}

/** Suggest tasks, with the review state its hook would hold. */
function SuggestTasks({ onApprove }: { onApprove: (items: NextTaskReviewItem[]) => void }) {
  const draft: AINextTasksDraft = {
    ...draftBase,
    draftId: 'd1',
    evidenceSummary: {
      goals: 0,
      milestones: 0,
      workItems: 0,
      watchEvents: 0,
      gitCommits: 0,
      harnessEvents: 0,
      windowDays: 7
    }
  }
  const [reviews, setReviews] = useState<NextTaskReviewItem[]>(
    SUGGESTIONS.map((item, suggestionIndex) => ({
      suggestionIndex,
      included: true,
      title: item.title,
      description: item.description,
      priority: item.priority,
      acceptanceCriteria: '',
      milestoneId: '',
      status: 'backlog',
      attachments: []
    }))
  )
  return (
    <AINextTasksModal
      nextTasksDraft={draft}
      nextTaskReviews={reviews}
      nextTasksBusy={false}
      nextTasksError={null}
      planningMilestones={[]}
      updateNextTaskReview={(index, updates) =>
        setReviews((current) =>
          current.map((item) => (item.suggestionIndex === index ? { ...item, ...updates } : item))
        )
      }
      closeNextTasksDraft={() => {}}
      generateNextTasks={() => {}}
      approveNextTasks={() => onApprove(reviews)}
    />
  )
}

/** Break down with AI, with the workspace members the dialog reads. */
function BreakDown({ onAdd }: { onAdd: (selected: number[], titles: string[]) => void }) {
  const [aiDraft, setAiDraft] = useState<AIPlanningDraft>({ ...draftBase, goalId: 'g1' })
  const [selected, setSelected] = useState<number[]>([0, 1, 2])
  const ws = {
    aiDraft,
    aiGoalTitle: 'Launch',
    busy: false,
    error: null,
    selectedSuggestions: selected,
    setSelectedSuggestions: setSelected,
    closeAiDraft: () => {},
    updateAiSuggestion: (index: number, update: Partial<AIPlanningSuggestion>) =>
      setAiDraft((current) => ({
        ...current,
        suggestions: current.suggestions.map((item, i) =>
          i === index ? { ...item, ...update } : item
        )
      })),
    addAiSuggestions: async () =>
      onAdd(
        selected,
        aiDraft.suggestions.map((item) => item.title)
      )
  } as unknown as PlanningWorkspace
  return <AiBreakdownDialog ws={ws} />
}

const dialogs = [
  {
    name: 'Suggest tasks',
    renderIt: (onAdd: (titles: string[]) => void) =>
      render(
        <SuggestTasks
          onApprove={(items) =>
            onAdd(items.filter((item) => item.included).map((item) => item.title))
          }
        />
      )
  },
  {
    name: 'Break down with AI',
    renderIt: (onAdd: (titles: string[]) => void) =>
      render(
        <BreakDown onAdd={(selected, titles) => onAdd(selected.sort().map((i) => titles[i]))} />
      )
  }
]

describe.each(dialogs)('the shared AI task review in $name', ({ renderIt }) => {
  beforeEach(() => {
    installOstlerApi()
  })

  it('ticks every suggestion by default and says how many will be added', () => {
    renderIt(vi.fn())
    const dialog = screen.getByRole('dialog')
    for (const n of [1, 2, 3]) {
      expect(
        within(dialog).getByRole('checkbox', { name: `Include Suggestion ${n}` })
      ).toBeChecked()
    }
    expect(within(dialog).getByRole('button', { name: 'Add 3 tasks' })).toBeEnabled()
    expect(within(dialog).queryByRole('button', { name: /Reject/ })).toBeNull()
    expect(within(dialog).getByText('test-model', { exact: false })).toBeInTheDocument()
  })

  it('turns a suggestion down by unticking it, and the count follows politely', () => {
    renderIt(vi.fn())
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include Suggestion 2' }))
    expect(within(dialog).getByRole('button', { name: 'Add 2 tasks' })).toBeInTheDocument()
    const status = within(dialog).getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('2 of 3 will be added')
    expect(within(dialog).getByRole('textbox', { name: 'Suggestion 2 title' })).toBeDisabled()
  })

  it('toggles the focused suggestion with Space', async () => {
    renderIt(vi.fn())
    const box = screen.getByRole('checkbox', { name: 'Include Suggestion 1' })
    box.focus()
    expect(box).toHaveFocus()
    // A native tick box toggles on Space; jsdom sends the click it makes.
    await act(async () => {
      fireEvent.keyDown(box, { key: ' ', code: 'Space' })
      fireEvent.keyUp(box, { key: ' ', code: 'Space' })
      fireEvent.click(box, { detail: 0 })
    })
    expect(box).not.toBeChecked()
    expect(screen.getByRole('status')).toHaveTextContent('2 of 3 will be added')
  })

  it('edits title and details in place, and adds only the ticked ones on the click', async () => {
    const onAdd = vi.fn()
    renderIt(onAdd)
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Suggestion 1 title' }), {
      target: { value: 'Edited' }
    })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Suggestion 1 details' }), {
      target: { value: 'New details' }
    })
    expect(within(dialog).getByRole('textbox', { name: 'Suggestion 1 details' })).toHaveValue(
      'New details'
    )
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include Suggestion 3' }))
    expect(onAdd).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add 2 tasks' }))
    })
    expect(onAdd).toHaveBeenCalledWith(['Edited', 'Draft 2'])
  })

  it('cannot add with nothing ticked or a ticked title empty', () => {
    renderIt(vi.fn())
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Suggestion 1 title' }), {
      target: { value: ' ' }
    })
    expect(within(dialog).getByRole('button', { name: 'Add 3 tasks' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    for (const n of [1, 2, 3]) {
      fireEvent.click(within(dialog).getByRole('checkbox', { name: `Include Suggestion ${n}` }))
    }
    expect(within(dialog).getByRole('button', { name: 'Add 0 tasks' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })
})
