// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AgentPlanWizard } from '@renderer/views/planning/AgentPlanWizard'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import type { PlanningGoal } from '@shared/ostler-api'
import { RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'

const goal: PlanningGoal = {
  id: 'g1',
  projectId: 'p1',
  title: 'Launch',
  outcome: '',
  status: 'active',
  createdAt: 1,
  updatedAt: 1
}

/**
 * What a browser does when Enter is pressed on a focused button: keydown,
 * then a click with no pointer (detail 0). jsdom does not synthesise the
 * click itself, so the test does, after checking the button holds focus.
 */
async function pressEnter(element: HTMLElement) {
  element.focus()
  expect(element).toHaveFocus()
  await act(async () => {
    fireEvent.keyDown(element, { key: 'Enter' })
    fireEvent.click(element, { detail: 0 })
    fireEvent.keyUp(element, { key: 'Enter' })
  })
}

const currentStep = () =>
  within(screen.getByRole('list', { name: 'Steps' }))
    .getAllByRole('listitem')
    .find((item) => item.getAttribute('aria-current') === 'step')?.textContent

describe('AgentPlanWizard', () => {
  it('steps forward and back by keyboard, showing where it is', async () => {
    const base = await renderPlanningWorkspace({
      projectId: 'p1',
      api: {
        getConfig: async () => ({ ok: true, value: RENDERER_DEFAULT_CONFIG }),
        getAITaskSplitJob: async () => ({ ok: true, value: null }),
        listLibraryItems: async () => ({ ok: true, value: [] }),
        getLibraryAiContextSummary: async () => ({ ok: false, error: 'none' })
      }
    })
    const ws: PlanningWorkspace = withWorkspace(base, { agentPlanGoal: goal })
    await act(async () => {
      render(<AgentPlanWizard ws={ws} />)
    })

    const dialog = screen.getByRole('dialog', { name: 'Plan "Launch" and split it into tasks' })
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual(['1Sources', '2Plan', '3Tasks', '4Review'])
    expect(currentStep()).toBe('1Sources')

    await pressEnter(within(dialog).getByRole('button', { name: 'Next' }))
    expect(currentStep()).toBe('2Plan')
    expect(within(dialog).getByRole('button', { name: 'Draft the plan' })).toBeInTheDocument()

    await pressEnter(within(dialog).getByRole('button', { name: 'Back' }))
    expect(currentStep()).toBe('1Sources')
    expect(within(dialog).getByRole('heading', { name: 'Always included' })).toBeInTheDocument()
  })
})
