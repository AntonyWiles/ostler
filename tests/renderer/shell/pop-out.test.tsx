// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RendererProject } from '@shared/ostler-api'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { describePopOutRoute, useOpenInNewWindow } from '@renderer/shell/pop-out'
import { installOstlerApi } from '../fixtures/ostler-api'

/**
 * Open in new window (N5.8a): the eight-window limit asks to close the
 * oldest, naming it, and opens the new one only if the person says so.
 */

const projects = [{ id: 'p1', name: 'Shop' } as RendererProject]

vi.mock('@renderer/context/OstlerContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@renderer/context/OstlerContext')>()),
  useOstler: () => ({ projects, areas: [], refreshProjects: async () => {} })
}))

function Opener({ route }: { route: string }) {
  const open = useOpenInNewWindow()
  return <button onClick={() => void open(route)}>Open</button>
}

function renderOpener(route: string) {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <Opener route={route} />
      </ConfirmProvider>
    </ToastProvider>
  )
}

describe('Open in new window (N5.8a)', () => {
  it('names what a pop-out shows', () => {
    expect(describePopOutRoute('/home', projects)).toBe('Home')
    expect(describePopOutRoute('/projects/p1/board', projects)).toBe('Shop - Board')
  })

  it('opens at once while fewer than eight are open', async () => {
    const openInNewWindow = vi.fn(async () => ({
      ok: true as const,
      value: { opened: true as const }
    }))
    installOstlerApi({ openInNewWindow })
    renderOpener('/home')
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(openInNewWindow).toHaveBeenCalledWith('/home'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('with eight open, asks to close the oldest and opens only when told to', async () => {
    const openInNewWindow = vi.fn(async (_route: string, closeOldest?: boolean) =>
      closeOldest
        ? { ok: true as const, value: { opened: true as const } }
        : {
            ok: true as const,
            value: { opened: false as const, full: true as const, oldest: '/projects/p1/board' }
          }
    )
    installOstlerApi({ openInNewWindow })
    renderOpener('/home')

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Eight windows are open' })
    expect(dialog.textContent).toContain('Shop - Board')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(openInNewWindow).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await screen.findByRole('alertdialog', { name: 'Eight windows are open' })
    fireEvent.click(screen.getByRole('button', { name: 'Close it and open' }))
    await waitFor(() => expect(openInNewWindow).toHaveBeenLastCalledWith('/home', true))
  })
})
