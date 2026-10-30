// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { StatusBarSharing } from '@renderer/components/StatusBarSharing'
import { installOstlerApi } from '../fixtures/ostler-api'

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <StatusBarSharing />
    </MemoryRouter>
  )

describe('the status bar sharing item', () => {
  it('says how a shared open project stands', async () => {
    installOstlerApi({
      getShareState: async (projectId) => ({
        ok: true,
        value:
          projectId === 'p1'
            ? {
                projectId,
                status: 'catching-up',
                folder: 'x',
                members: [],
                lastSyncedAt: null,
                waitingToSend: 0,
                waitingToApply: 0,
                problems: [],
                removed: false,
                myRole: 'owner',
                inPersonalSpace: false,
                sharedCapabilities: []
              }
            : null
      })
    })
    renderAt('/projects/p1/board')
    // Catching up shows only once it has lasted a few seconds (MOP-29).
    expect(screen.queryByText('Shared between your PCs · catching up')).toBeNull()
    expect(
      await screen.findByText('Shared between your PCs · catching up', undefined, { timeout: 4000 })
    ).toBeInTheDocument()
  }, 8000)

  it('shows nothing for a project that is not shared, or outside a project', async () => {
    installOstlerApi({ getShareState: async () => ({ ok: true, value: null }) })
    const { container } = renderAt('/projects/p2/board')
    await Promise.resolve()
    expect(container.textContent).toBe('')
    expect(render(<StatusBarSharing />).container.textContent).toBe('')
  })
})
