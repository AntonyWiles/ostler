// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OstlerAPI, PlanningWorkItem } from '@shared/ostler-api'
import type { TriageSuggestion } from '@shared/triage-suggestions'
import { TriageView } from '@renderer/views/planning/triage/TriageView'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { makeWorkItem } from '../../fixtures/planning-records'
import { installOstlerApi } from '../../fixtures/ostler-api'

const ITEMS = () => [
  makeWorkItem('a', { title: 'Header broken on mobile', inTriage: true, capturedBy: 'quick-add' }),
  makeWorkItem('b', { title: 'Snipped bug', inTriage: true, capturedBy: 'snip' })
]
const ORIGINAL = makeWorkItem('o', { title: 'Fix the header on mobile', status: 'active' })

const SUGGESTION = (workItemId = 'a'): TriageSuggestion => ({
  workItemId,
  priority: 'high',
  labels: ['design', 'website'],
  duplicates: [
    { workItemId: 'o', title: 'Fix the header on mobile', status: 'active', reason: 'Same bug' }
  ],
  dropped: 0
})

function renderTriage(
  api: Partial<OstlerAPI> = {},
  {
    ai = true,
    openWorkItem
  }: { ai?: boolean; openWorkItem?: (item: PlanningWorkItem) => void } = {}
) {
  installOstlerApi({
    getTriage: async () => ({ ok: true, value: { items: ITEMS(), pictures: {} } }),
    ...api
  })
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <StaticFeaturesProvider value={{ agents: false, ai }}>
          <StaticPeopleProvider people={[]}>
            <TriageView
              ws={{
                projectId: 'p1',
                workItems: [ORIGINAL],
                milestones: [],
                openWorkItem,
                loadPlanning: async () => undefined
              }}
            />
          </StaticPeopleProvider>
        </StaticFeaturesProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}

const row = (title: string) =>
  screen.getByRole('listitem', { name: new RegExp(`^${title}, Captured`) })

describe('Triage suggestions (N4.3b)', () => {
  beforeEach(() => __resetDismissableStackForTests())
  afterEach(() => vi.restoreAllMocks())

  it('hides Suggest and Suggest for all while Ostler AI is not set up', async () => {
    renderTriage({}, { ai: false })
    await screen.findByText('Header broken on mobile')
    expect(screen.queryByRole('button', { name: /^Suggest/ })).toBeNull()
  })

  it('shows a row’s suggestion, and Use fills its fields without saving', async () => {
    const suggestTriage = vi.fn(async () => ({ ok: true as const, value: SUGGESTION() }))
    const acceptTriagedWorkItem = vi.fn(async () => ({
      ok: true as const,
      value: makeWorkItem('a')
    }))
    const updatePlanningWorkItem = vi.fn()
    renderTriage({ suggestTriage, acceptTriagedWorkItem, updatePlanningWorkItem })
    await screen.findByText('Header broken on mobile')
    const first = row('Header broken on mobile')
    fireEvent.click(
      within(first).getByRole('button', { name: 'Suggest for “Header broken on mobile”' })
    )
    expect(suggestTriage).toHaveBeenCalledWith('p1', 'a')
    expect(
      await within(first).findByText(
        /High · design, website · Looks like “Fix the header on mobile” \(/
      )
    ).toBeTruthy()

    fireEvent.click(within(first).getByRole('button', { name: /^Use the suggested/ }))
    expect((within(first).getByLabelText('Priority') as HTMLSelectElement).value).toBe('high')
    expect((within(first).getByLabelText('Labels') as HTMLInputElement).value).toBe(
      'design, website'
    )
    expect(acceptTriagedWorkItem).not.toHaveBeenCalled()
    expect(updatePlanningWorkItem).not.toHaveBeenCalled()

    fireEvent.click(within(first).getByRole('button', { name: /^Accept/ }))
    await waitFor(() =>
      expect(acceptTriagedWorkItem).toHaveBeenCalledWith(
        'p1',
        'a',
        expect.objectContaining({ priority: 'high', labels: ['design', 'website'] })
      )
    )
  })

  it('marks it as a duplicate of a suggested task, and opens that task', async () => {
    const markPlanningWorkItemDuplicate = vi.fn(async () => ({
      ok: true as const,
      value: {
        workItem: makeWorkItem('a'),
        link: { id: 'link-1' } as never,
        cancelledTask: false
      }
    }))
    const openWorkItem = vi.fn()
    renderTriage(
      {
        suggestTriage: async () => ({ ok: true, value: SUGGESTION() }),
        markPlanningWorkItemDuplicate
      },
      { openWorkItem }
    )
    await screen.findByText('Header broken on mobile')
    const first = row('Header broken on mobile')
    fireEvent.click(within(first).getByRole('button', { name: /^Suggest for/ }))
    fireEvent.click(
      await within(first).findByRole('button', { name: 'Open “Fix the header on mobile”' })
    )
    expect(openWorkItem).toHaveBeenCalledWith(ORIGINAL)
    fireEvent.click(
      within(first).getByRole('button', {
        name: 'Mark “Header broken on mobile” as a duplicate of “Fix the header on mobile”'
      })
    )
    await waitFor(() => expect(markPlanningWorkItemDuplicate).toHaveBeenCalledWith('a', 'o'))
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('asks before Suggest for all, says how many requests, and can stop', async () => {
    let release: () => void = () => undefined
    const suggestTriage = vi.fn(
      (_projectId: string, workItemId: string) =>
        new Promise<{ ok: true; value: TriageSuggestion }>((resolve) => {
          release = () => resolve({ ok: true, value: SUGGESTION(workItemId) })
        })
    )
    renderTriage({ suggestTriage })
    await screen.findByText('Header broken on mobile')
    fireEvent.click(screen.getByRole('button', { name: 'Suggest for all' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/This makes 2 requests/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suggest' }))
    await waitFor(() => expect(suggestTriage).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Suggesting 0 of 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop suggesting' }))
    release()
    expect(await within(row('Header broken on mobile')).findByText(/Looks like/)).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Suggest for all' })).toBeTruthy()
    )
    expect(suggestTriage).toHaveBeenCalledTimes(1)
  })

  it('makes no request when Suggest for all is cancelled', async () => {
    const suggestTriage = vi.fn()
    renderTriage({ suggestTriage })
    await screen.findByText('Header broken on mobile')
    fireEvent.click(screen.getByRole('button', { name: 'Suggest for all' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(suggestTriage).not.toHaveBeenCalled()
  })
})
