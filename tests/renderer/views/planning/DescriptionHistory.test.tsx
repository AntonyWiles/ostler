// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PlanningDescriptionVersion } from '@shared/ostler-api'
import { ToastProvider } from '@renderer/ui'
import { DescriptionHistory } from '@renderer/views/planning/DescriptionHistory'
import { installOstlerApi } from '../../fixtures/ostler-api'

const ok = <T,>(value: T) => ({ ok: true as const, value })

function version(
  id: number,
  text: string,
  name = 'Alex',
  at = new Date(2026, 9, 16, 9, id).getTime()
): PlanningDescriptionVersion {
  return {
    id,
    projectId: 'p1',
    workItemId: 'a',
    text,
    actor: { kind: 'human', personId: null, name },
    startedAt: at,
    endedAt: at
  }
}

function renderHistory(
  versions: PlanningDescriptionVersion[],
  onRestore = vi.fn(async () => ({ ok: true as const, undo: vi.fn(async () => true) }))
) {
  installOstlerApi({ getPlanningDescriptionVersions: async () => ok(versions) })
  render(
    <ToastProvider>
      <DescriptionHistory
        workItemId="a"
        current={'Steps\nNew step'}
        updatedAt={1}
        onRestore={onRestore}
      />
    </ToastProvider>
  )
  return onRestore
}

describe('DescriptionHistory (N2.6)', () => {
  it('shows no History button while there is no earlier version', async () => {
    renderHistory([])
    await waitFor(() => expect(window.ostlerAPI).toBeDefined())
    expect(screen.queryByRole('button', { name: /history/i })).toBeNull()
  })

  it('lists versions, compares one with today’s text in words, and restores it', async () => {
    const onRestore = renderHistory([
      version(2, 'Steps\nOld step', 'Built-in agent'),
      version(1, 'First idea')
    ])
    fireEvent.click(await screen.findByRole('button', { name: 'History' }))
    const dialog = await screen.findByRole('dialog')
    const list = within(dialog).getByRole('list', { name: 'Versions' })
    const items = within(list).getAllByRole('button')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Built-in agent')
    expect(items[0]).toHaveTextContent('14 characters')
    expect(items[0]).toHaveAttribute('aria-pressed', 'true')

    // The newest is compared first: added and removed lines are named, not only coloured.
    const compare = await within(dialog).findByRole('region', {
      name: 'This version compared with today’s text'
    })
    expect(compare).toHaveTextContent('1 lines added since, 1 removed')
    expect(within(compare).getByText('Removed').closest('li')).toHaveTextContent('Old step')
    expect(within(compare).getByText('Added').closest('li')).toHaveTextContent('New step')

    fireEvent.click(items[1])
    expect(items[1]).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() =>
      expect(
        within(dialog).getByRole('region', { name: 'This version compared with today’s text' })
      ).toHaveTextContent('First idea')
    )

    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(1))
    expect(await screen.findByText('Description restored')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument()
  })

  it('works from the keyboard: every control is a focusable button, and Escape closes', async () => {
    const onRestore = renderHistory([version(2, 'Second'), version(1, 'First')])
    const open = await screen.findByRole('button', { name: 'History' })
    const focusAndPress = (element: HTMLElement) => {
      expect(element.tagName).toBe('BUTTON')
      element.focus()
      expect(document.activeElement).toBe(element)
      // A native button runs its click on Enter and Space.
      fireEvent.click(element)
    }
    focusAndPress(open)
    const dialog = await screen.findByRole('dialog')
    const [, older] = within(within(dialog).getByRole('list', { name: 'Versions' })).getAllByRole(
      'button'
    )
    focusAndPress(older)
    expect(older).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    focusAndPress(screen.getByRole('button', { name: 'History' }))
    const again = await screen.findByRole('dialog')
    focusAndPress(
      within(within(again).getByRole('list', { name: 'Versions' })).getAllByRole('button')[1]
    )
    focusAndPress(within(again).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(1))
  })
})
