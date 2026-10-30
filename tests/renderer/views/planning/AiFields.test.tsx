// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AiFieldSuggestion,
  CreatePlanningFieldInput,
  PlanningFieldDefinition,
  Result
} from '@shared/ostler-api'
import { aiFieldSourceHash } from '@shared/planning/ai-fields'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { ProjectFieldsManager } from '@renderer/components/ProjectFieldsManager'
import { TaskCustomFieldsSection } from '@renderer/views/planning/TaskCustomFieldsSection'
import { TaskBulkBar } from '@renderer/views/planning/TaskBulkBar'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { makeWorkItem } from '../../fixtures/planning-records'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'

/** AI fields (N8.4): defining one, Fill with AI in the drawer and in bulk, and the marks. */

const SUMMARY: PlanningFieldDefinition = {
  id: 'f1',
  projectId: 'p1',
  name: 'Summary',
  type: 'text',
  options: [],
  position: 0,
  createdAt: 0,
  aiInstruction: 'Summarise in one line'
}

function shell(children: ReactNode, ai = true) {
  return (
    <StaticFeaturesProvider value={{ ai, agents: false }}>
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    </StaticFeaturesProvider>
  )
}

let base: PlanningWorkspace
beforeEach(async () => {
  base = await renderPlanningWorkspace()
})

describe('defining an AI field', () => {
  it('gives a Text field an instruction with Fill with AI', async () => {
    const createPlanningField = vi.fn(
      async (_projectId: string, input: CreatePlanningFieldInput) => ({
        ok: true as const,
        value: { ...SUMMARY, name: input.name, aiInstruction: input.aiInstruction ?? null }
      })
    )
    installOstlerApi({
      getPlanningFields: async () => ({ ok: true, value: [] }),
      createPlanningField
    })
    render(shell(<ProjectFieldsManager projectId="p1" onError={() => {}} onSaved={() => {}} />))
    fireEvent.click(await screen.findByRole('button', { name: 'Add field' }))
    fireEvent.change(screen.getByLabelText('Field name'), { target: { value: 'Summary' } })
    fireEvent.click(screen.getByLabelText(/Fill with AI/))
    expect(screen.getByText(/Each request sends the field’s name/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Instruction for Ostler AI/), {
      target: { value: 'Summarise in one line' }
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add field' }).at(-1)!)
    await waitFor(() =>
      expect(createPlanningField).toHaveBeenCalledWith('p1', {
        name: 'Summary',
        type: 'text',
        options: undefined,
        aiInstruction: 'Summarise in one line'
      })
    )
  })

  it('notes that a Choice answer must be an option, and offers nothing while AI is off', async () => {
    installOstlerApi({ getPlanningFields: async () => ({ ok: true, value: [] }) })
    const { unmount } = render(
      shell(<ProjectFieldsManager projectId="p1" onError={() => {}} onSaved={() => {}} />)
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Add field' }))
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'choice' } })
    fireEvent.click(screen.getByLabelText(/Fill with AI/))
    expect(screen.getByText(/must be one of this field’s options/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'number' } })
    expect(screen.queryByLabelText(/Fill with AI/)).toBeNull()
    unmount()

    render(
      shell(<ProjectFieldsManager projectId="p1" onError={() => {}} onSaved={() => {}} />, false)
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Add field' }))
    expect(screen.queryByLabelText(/Fill with AI/)).toBeNull()
  })
})

describe('Fill with AI in the drawer', () => {
  it('asks Ostler AI, then saves its suggestion as one fill with undo', async () => {
    const item = makeWorkItem('w1', { title: 'Paint the hall', fieldValues: {}, fieldFills: {} })
    const suggestion: AiFieldSuggestion = {
      workItemId: 'w1',
      fieldId: 'f1',
      value: 'Hall paint job',
      note: null,
      sourceHash: aiFieldSourceHash(item)
    }
    const suggestAiFieldValue = vi.fn(async () => ({ ok: true as const, value: suggestion }))
    const applyAiFieldFills = vi.fn(async () => ({
      ok: true as const,
      value: { filled: ['w1'], skipped: [], before: { fieldId: 'f1', values: [] } }
    }))
    installOstlerApi({ suggestAiFieldValue, applyAiFieldFills })
    render(
      shell(
        <TaskCustomFieldsSection
          ws={withWorkspace(base, {
            fields: [SUMMARY],
            selectedWorkItem: item,
            editFieldValues: {},
            saveFailures: [],
            loadPlanning: async () => {}
          })}
        />
      )
    )
    // The sparkle beside the field's name.
    expect(screen.getAllByRole('img', { name: 'AI field' }).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Fill with AI: Summary' }))
    await waitFor(() =>
      expect(applyAiFieldFills).toHaveBeenCalledWith(
        'p1',
        'f1',
        [{ workItemId: 'w1', value: 'Hall paint job', sourceHash: suggestion.sourceHash }],
        { replacePersonValues: false }
      )
    )
    expect(suggestAiFieldValue).toHaveBeenCalledWith('p1', 'w1', 'f1')
    expect(await screen.findByText('Ostler AI filled Summary')).toBeTruthy()
  })

  it('marks Ostler AI’s value, and says it may be out of date with Fill again', () => {
    const fresh = makeWorkItem('w1', { title: 'Paint', fieldValues: { f1: 'Paint job' } })
    const filled = {
      ...fresh,
      fieldFills: {
        f1: { filledBy: 'ostler-ai' as const, sourceHash: aiFieldSourceHash(fresh) }
      }
    }
    const { rerender } = render(
      shell(
        <TaskCustomFieldsSection
          ws={withWorkspace(base, {
            fields: [SUMMARY],
            selectedWorkItem: filled,
            editFieldValues: { f1: 'Paint job' },
            saveFailures: []
          })}
        />
      )
    )
    expect(screen.getByRole('img', { name: 'Filled by Ostler AI' })).toBeTruthy()
    expect(screen.queryByText('May be out of date')).toBeNull()

    const changed = { ...filled, title: 'Paint and plaster' }
    rerender(
      shell(
        <TaskCustomFieldsSection
          ws={withWorkspace(base, {
            fields: [SUMMARY],
            selectedWorkItem: changed,
            editFieldValues: { f1: 'Paint job' },
            saveFailures: []
          })}
        />
      )
    )
    expect(
      screen.getByRole('img', { name: 'Filled by Ostler AI. May be out of date' })
    ).toBeTruthy()
    expect(screen.getByText('May be out of date')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fill again: Summary' })).toBeTruthy()
  })
})

describe('Fill with AI for selected tasks', () => {
  it('fills one task at a time with progress, and Stop keeps what was filled', async () => {
    const items = ['w1', 'w2', 'w3'].map((id) => makeWorkItem(id, { title: `Task ${id}` }))
    const pending: Array<(result: Result<AiFieldSuggestion>) => void> = []
    const suggestAiFieldValue = vi.fn(
      (_projectId: string, workItemId: string) =>
        new Promise<Result<AiFieldSuggestion>>((resolve) =>
          pending.push(() =>
            resolve({
              ok: true,
              value: {
                workItemId,
                fieldId: 'f1',
                value: `Summary of ${workItemId}`,
                note: null,
                sourceHash: '0000abcd'
              }
            })
          )
        )
    )
    const applyAiFieldFills = vi.fn(async () => ({
      ok: true as const,
      value: { filled: ['w1'], skipped: [], before: { fieldId: 'f1', values: [] } }
    }))
    installOstlerApi({ suggestAiFieldValue, applyAiFieldFills })
    render(
      shell(
        <TaskBulkBar
          ws={withWorkspace(base, {
            fields: [SUMMARY],
            workItemsById: new Map(items.map((item) => [item.id, item])),
            loadPlanning: async () => {}
          })}
          selectedIds={['w1', 'w2', 'w3']}
          onClear={() => {}}
        />
      )
    )
    fireEvent.change(screen.getByLabelText('Fill with AI'), { target: { value: 'f1' } })
    expect(await screen.findByText('Filling Summary: 0 of 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await act(async () => pending[0]({} as never))
    await waitFor(() => expect(applyAiFieldFills).toHaveBeenCalled())
    // Stopped after the request in flight: one request, one save.
    expect(suggestAiFieldValue).toHaveBeenCalledTimes(1)
    expect(applyAiFieldFills).toHaveBeenCalledWith(
      'p1',
      'f1',
      [{ workItemId: 'w1', value: 'Summary of w1', sourceHash: '0000abcd' }],
      { replacePersonValues: false }
    )
  })

  it('asks before replacing values the person entered', async () => {
    const mine = makeWorkItem('w1', { title: 'Mine', fieldValues: { f1: 'My words' } })
    installOstlerApi({})
    render(
      shell(
        <TaskBulkBar
          ws={withWorkspace(base, {
            fields: [SUMMARY],
            workItemsById: new Map([[mine.id, mine]]),
            loadPlanning: async () => {}
          })}
          selectedIds={['w1']}
          onClear={() => {}}
        />
      )
    )
    fireEvent.change(screen.getByLabelText('Fill with AI'), { target: { value: 'f1' } })
    expect(await screen.findByText('Replace 1 value you entered?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }))
    expect(
      await screen.findByText('Nothing to fill: every selected task has a value you entered.')
    ).toBeTruthy()
  })
})
