// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { TaskLink, TaskPeekProvider } from '@renderer/views/planning/TaskPeek'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function renderLinks(withPeek: boolean) {
  const task = makeWorkItem('a', { title: 'Write brief', projectId: 'p1' })
  installOstlerApi({
    ...emptyPlanningReads(),
    getPlanningWorkItems: async () => ({ ok: true, value: [task] }),
    getPlanningActivity: async () => ({ ok: true, value: { entries: [], nextBefore: null } })
  })
  const link = (
    <TaskLink projectId="p1" taskId="a">
      Write brief
    </TaskLink>
  )
  render(
    <MemoryRouter initialEntries={['/']}>
      <ToastProvider>
        <ConfirmProvider>
          <StaticFeaturesProvider value={{ agents: false, ai: false }}>
            <Routes>
              <Route
                path="*"
                element={withPeek ? <TaskPeekProvider>{link}</TaskPeekProvider> : link}
              />
            </Routes>
            <Where />
          </StaticFeaturesProvider>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>
  )
}

describe('Tasks open where they were clicked (MOP-30)', () => {
  it('opens the task’s drawer over the page and stays on it', async () => {
    renderLinks(true)
    fireEvent.click(screen.getByRole('link', { name: 'Write brief' }))
    expect(await screen.findByRole('textbox', { name: 'Description' })).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/')
  })

  it('goes to the task in its project with Ctrl held', async () => {
    renderLinks(true)
    fireEvent.click(screen.getByRole('link', { name: 'Write brief' }), { ctrlKey: true })
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/projects/p1/tasks/a')
    )
  })

  it('is a plain link to the task outside the peek', () => {
    renderLinks(false)
    fireEvent.click(screen.getByRole('link', { name: 'Write brief' }))
    expect(screen.getByTestId('where').textContent).toBe('/projects/p1/tasks/a')
  })
})
