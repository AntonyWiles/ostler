// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { StickyPinResult } from '@shared/sticky-task'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { usePinToDesktop } from '@renderer/shell/sticky-task'
import { installOstlerApi } from '../fixtures/ostler-api'
import { makeWorkItem } from '../fixtures/planning-records'

/**
 * Pin to desktop (N5.8b): pins at once while fewer than five are pinned; the
 * sixth asks to unpin the oldest, naming it, and pins only if told to.
 */

function Pinner() {
  const pin = usePinToDesktop()
  return <button onClick={() => void pin({ projectId: 'p1', taskId: 't9' })}>Pin</button>
}

function renderPinner() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <Pinner />
      </ConfirmProvider>
    </ToastProvider>
  )
}

describe('Pin to desktop (N5.8b)', () => {
  it('pins at once while fewer than five are pinned', async () => {
    const pinTaskToDesktop = vi.fn(async () => ({
      ok: true as const,
      value: { pinned: true } as StickyPinResult
    }))
    installOstlerApi({ pinTaskToDesktop })
    renderPinner()
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))
    await waitFor(() => expect(pinTaskToDesktop).toHaveBeenCalledWith('p1', 't9'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('with five pinned, asks to unpin the oldest and pins only when told to', async () => {
    const pinTaskToDesktop = vi.fn(
      async (_projectId: string, _taskId: string, unpinOldest?: boolean) => ({
        ok: true as const,
        value: (unpinOldest
          ? { pinned: true }
          : {
              pinned: false,
              full: true,
              oldest: { projectId: 'p1', taskId: 't1' }
            }) as StickyPinResult
      })
    )
    installOstlerApi({
      pinTaskToDesktop,
      getPlanningWorkItems: async () => ({
        ok: true as const,
        value: [makeWorkItem('t1', { title: 'Pay the rent' })]
      })
    })
    renderPinner()
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))
    expect(
      await screen.findByText('Unpin the oldest, Pay the rent, and pin this one?')
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Unpin it and pin this one' }))
    await waitFor(() => expect(pinTaskToDesktop).toHaveBeenCalledWith('p1', 't9', true))
  })
})
