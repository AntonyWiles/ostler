// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CreatePlanningRuleInput, PlanningRule, PlanningWorkItem } from '@shared/ostler-api'
import { ProjectRulesManager } from '@renderer/rules/ProjectRulesManager'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

function rule(overrides: Partial<PlanningRule>): PlanningRule {
  return {
    id: 'r1',
    projectId: 'p1',
    name: 'Escalate',
    enabled: true,
    trigger: { kind: 'statusChanged', to: 'blocked' },
    conditions: [{ kind: 'label', op: 'is', label: 'urgent' }],
    actions: [{ kind: 'setPriority', priority: 'critical' }],
    lastRunAt: null,
    runCount: 2,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

/** A fake main process holding the project's rules. */
function setup(initial: PlanningRule[]) {
  let rules = [...initial]
  const createPlanningRule = vi.fn(async (_projectId: string, input: CreatePlanningRuleInput) => {
    const created = rule({ ...input, id: `r${rules.length + 1}`, runCount: 0 })
    rules = [...rules, created]
    return { ok: true as const, value: created }
  })
  const updatePlanningRule = vi.fn(async (ruleId: string, updates: Partial<PlanningRule>) => {
    rules = rules.map((entry) => (entry.id === ruleId ? { ...entry, ...updates } : entry))
    return { ok: true as const, value: rules.find((entry) => entry.id === ruleId)! }
  })
  const deletePlanningRule = vi.fn(async (ruleId: string) => {
    const gone = rules.find((entry) => entry.id === ruleId)!
    rules = rules.filter((entry) => entry.id !== ruleId)
    return { ok: true as const, value: { rule: gone } }
  })
  const restorePlanningRule = vi.fn(async ({ rule: back }: { rule: PlanningRule }) => {
    rules = [...rules, back]
    return { ok: true as const, value: back }
  })
  const previewPlanningRule = vi.fn(async () => ({
    ok: true as const,
    value: {
      conditions: [true],
      matches: true,
      effects: [{ action: { kind: 'notifyMe' as const, message: '' }, outcome: 'change' as const }]
    }
  }))
  installOstlerApi({
    getPlanningRules: async () => ({ ok: true, value: rules }),
    getPlanningMilestones: async () => ({ ok: true, value: [] }),
    getPlanningLabels: async () => ({
      ok: true,
      value: [{ name: 'urgent', color: '#f00', taskCount: 1, libraryItemCount: 0, hasColor: true }]
    }),
    getPlanningFields: async () => ({ ok: true, value: [] }),
    getPlanningColumnSettings: async () => ({ ok: true, value: {} }),
    getPlanningWorkItems: async () => ({
      ok: true,
      value: [{ id: 'w1', title: 'Fix the login' } as PlanningWorkItem]
    }),
    createPlanningRule,
    updatePlanningRule,
    deletePlanningRule,
    restorePlanningRule,
    previewPlanningRule
  })
  render(
    <ToastProvider>
      <ProjectRulesManager projectId="p1" onError={() => {}} onSaved={() => {}} />
    </ToastProvider>
  )
  return {
    createPlanningRule,
    updatePlanningRule,
    deletePlanningRule,
    restorePlanningRule,
    previewPlanningRule
  }
}

describe('ProjectRulesManager (R6.2)', () => {
  it('says when the project has no rules yet', async () => {
    setup([])
    expect(await screen.findByText('No rules yet.')).toBeTruthy()
  })

  it('shows each rule as a sentence with its switch', async () => {
    const { updatePlanningRule } = setup([rule({})])
    const toggle = await screen.findByRole('switch', { name: 'Escalate' })
    expect(
      screen.getByText(
        'When a task moves to Blocked, if it has the label “urgent”, then set the priority to Critical.'
      )
    ).toBeTruthy()
    expect(screen.getByText('Ran 2 times')).toBeTruthy()
    fireEvent.click(toggle)
    await waitFor(() => expect(updatePlanningRule).toHaveBeenCalledWith('r1', { enabled: false }))
  })

  it('builds a new rule as a sentence and saves it', async () => {
    const { createPlanningRule } = setup([])
    fireEvent.click(await screen.findByRole('button', { name: 'New rule' }))
    const form = screen.getByRole('form', { name: 'New rule' })
    fireEvent.change(within(form).getByLabelText('Rule name'), { target: { value: 'Ping me' } })
    fireEvent.change(within(form).getByLabelText('To'), { target: { value: 'review' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add condition' }))
    expect(
      within(form).getByText(
        'When a task moves to In review, if it has the label “urgent”, then notify me.'
      )
    ).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Save rule' }))
    await waitFor(() =>
      expect(createPlanningRule).toHaveBeenCalledWith('p1', {
        name: 'Ping me',
        trigger: { kind: 'statusChanged', to: 'review' },
        conditions: [{ kind: 'label', op: 'is', label: 'urgent' }],
        actions: [{ kind: 'notifyMe', message: '' }]
      })
    )
  })

  it('tries the rule on a task without saving anything', async () => {
    const { previewPlanningRule, createPlanningRule } = setup([])
    fireEvent.click(await screen.findByRole('button', { name: 'New rule' }))
    fireEvent.click(screen.getByRole('button', { name: 'Try it on a task…' }))
    expect(await screen.findByLabelText('Task to try it on')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try' }))
    expect(await screen.findByText('notify me')).toBeTruthy()
    expect(previewPlanningRule).toHaveBeenCalledWith(
      'p1',
      { conditions: [], actions: [{ kind: 'notifyMe', message: '' }] },
      'w1'
    )
    expect(createPlanningRule).not.toHaveBeenCalled()
  })

  it('deletes a rule at once and offers undo', async () => {
    const { deletePlanningRule, restorePlanningRule } = setup([rule({})])
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Escalate' }))
    await waitFor(() => expect(deletePlanningRule).toHaveBeenCalledWith('r1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(restorePlanningRule).toHaveBeenCalled())
    expect(await screen.findByRole('switch', { name: 'Escalate' })).toBeTruthy()
  })
})
