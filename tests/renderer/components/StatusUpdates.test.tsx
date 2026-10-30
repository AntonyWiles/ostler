// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RendererProject, StatusUpdate } from '@shared/ostler-api'
import { StatusUpdateSection } from '@renderer/components/status-updates/StatusUpdateSection'
import { StatusUpdateDialog } from '@renderer/components/status-updates/StatusUpdateDialog'
import { StatusUpdateChip } from '@renderer/components/status-updates/StatusUpdateChip'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

const DAY = 86_400_000
const NOW = new Date(2026, 9, 12, 10, 0).getTime()

const project = {
  id: 'p1',
  name: 'Website',
  path: null,
  color: '#3b82f6',
  enabled: true,
  customIgnorePatterns: [],
  notes: '',
  tags: [],
  addedAt: 0,
  lastActivity: null,
  hasAutomationToken: false
} as RendererProject

function update(overrides: Partial<StatusUpdate>): StatusUpdate {
  return {
    id: 'u1',
    projectId: 'p1',
    health: 'on-track',
    note: 'Going **well**',
    authorKind: 'human',
    authorPersonId: 'me',
    authorName: 'Alex',
    postedAt: NOW - DAY,
    editedAt: null,
    ...overrides
  }
}

function wrap(element: ReactElement, ai = false, entry = '/projects/p1/overview') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <StaticFeaturesProvider value={{ agents: false, ai }}>
        <ToastProvider>
          <ConfirmProvider>{element}</ConfirmProvider>
        </ToastProvider>
      </StaticFeaturesProvider>
    </MemoryRouter>
  )
}

describe('the posting dialog (N5.5)', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('picks the health by keyboard, with words and icons, and posts nothing until Post', async () => {
    const postStatusUpdate = vi.fn(async (_projectId: string, input: { health: string }) => ({
      ok: true as const,
      value: update({ health: input.health as StatusUpdate['health'] })
    }))
    installOstlerApi({ postStatusUpdate })
    const onSaved = vi.fn()
    wrap(
      <StatusUpdateDialog
        projectId="p1"
        projectName="Website"
        onClose={() => {}}
        onSaved={onSaved}
      />
    )
    const group = screen.getByRole('radiogroup', { name: 'How is it going?' })
    const options = within(group).getAllByRole('radio')
    expect(options.map((option) => option.textContent)).toEqual([
      'On track',
      'At risk',
      'Off track'
    ])
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    // No Draft from activity while Ostler AI is off.
    expect(screen.queryByRole('button', { name: 'Draft from activity' })).toBeNull()

    fireEvent.click(options[0])
    fireEvent.keyDown(options[0], { key: 'ArrowRight' })
    expect(options[1]).toHaveAttribute('aria-checked', 'true')
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Review slipped' } })
    expect(postStatusUpdate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() =>
      expect(postStatusUpdate).toHaveBeenCalledWith('p1', {
        health: 'at-risk',
        note: 'Review slipped'
      })
    )
    expect(onSaved).toHaveBeenCalled()
  })

  it('fills the dialog from Draft from activity, saying how much it had to go on', async () => {
    const draftStatusUpdate = vi.fn(async () => ({
      ok: true as const,
      value: { health: 'at-risk' as const, note: 'Only 2 changes.', changes: 2, since: NOW - DAY }
    }))
    const postStatusUpdate = vi.fn()
    installOstlerApi({ draftStatusUpdate, postStatusUpdate })
    wrap(
      <StatusUpdateDialog
        projectId="p1"
        projectName="Website"
        onClose={() => {}}
        onSaved={() => {}}
      />,
      true
    )
    fireEvent.click(screen.getByRole('button', { name: 'Draft from activity' }))
    await waitFor(() => expect(screen.getByLabelText('Note')).toHaveValue('Only 2 changes.'))
    expect(screen.getByRole('radio', { name: 'At risk' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/Drafted from 2 changes since/)).toBeInTheDocument()
    expect(postStatusUpdate).not.toHaveBeenCalled()
  })

  it('refuses a note over 2,000 characters', () => {
    installOstlerApi({})
    wrap(
      <StatusUpdateDialog
        projectId="p1"
        projectName="Website"
        editing={update({})}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'x'.repeat(2001) } })
    expect(screen.getByText('A note can be at most 2,000 characters.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

describe("the Overview's status (N5.5)", () => {
  it('shows the latest update with who and when, and History of the rest', async () => {
    installOstlerApi({
      listStatusUpdates: async () => ({
        ok: true,
        value: [
          update({ id: 'u2', health: 'at-risk', note: 'Copy is late', postedAt: NOW }),
          update({
            id: 'u1',
            note: 'Started',
            authorKind: 'automation',
            authorName: 'Automation API'
          })
        ]
      })
    })
    wrap(<StatusUpdateSection project={project} />)
    expect(await screen.findByText('Copy is late')).toBeInTheDocument()
    expect(screen.getByText('At risk')).toBeInTheDocument()
    expect(screen.getByText(/Alex ·/)).toBeInTheDocument()
    expect(screen.queryByText('Started')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'History (1 earlier update)' }))
    const history = screen.getByRole('list', { name: 'Earlier status updates' })
    expect(within(history).getByText('Started')).toBeInTheDocument()
    expect(within(history).getByText(/Automation API ·/)).toBeInTheDocument()
  })

  it('deletes an update at once and offers undo', async () => {
    let live = [update({})]
    const deleteStatusUpdate = vi.fn(async () => {
      const gone = live[0]
      live = []
      return { ok: true as const, value: gone }
    })
    const restoreStatusUpdate = vi.fn(async () => {
      live = [update({})]
      return { ok: true as const, value: live[0] }
    })
    installOstlerApi({
      listStatusUpdates: async () => ({ ok: true, value: live }),
      deleteStatusUpdate,
      restoreStatusUpdate
    })
    wrap(<StatusUpdateSection project={project} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete status update' }))
    expect(await screen.findByText('Status update deleted')).toBeInTheDocument()
    expect(await screen.findByText(/No status update yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(restoreStatusUpdate).toHaveBeenCalledWith('u1'))
    expect(await screen.findByText('well')).toBeInTheDocument()
  })

  it('opens the posting dialog from ?postUpdate=1', async () => {
    installOstlerApi({ listStatusUpdates: async () => ({ ok: true, value: [] }) })
    wrap(<StatusUpdateSection project={project} />, false, '/projects/p1/overview?postUpdate=1')
    expect(
      await screen.findByRole('dialog', { name: 'Post a status update · Website' })
    ).toBeInTheDocument()
  })
})

describe("Home's chip (N5.5)", () => {
  it('shows the health in words, no update yet, or how old it is', () => {
    const { rerender } = render(<StatusUpdateChip latest={null} reminder={undefined} now={NOW} />)
    expect(screen.getByText('No update yet')).toBeInTheDocument()
    rerender(<StatusUpdateChip latest={update({})} reminder={undefined} now={NOW} />)
    expect(screen.getByText('On track')).toBeInTheDocument()
    expect(screen.getByText('Latest status update:')).toBeInTheDocument()
    expect(screen.queryByText(/Last update/)).toBeNull()
    rerender(
      <StatusUpdateChip
        latest={update({ health: 'off-track', postedAt: NOW - 35 * DAY })}
        reminder={{ cadence: 'weekly', weekday: 1, since: '2026-09-01' }}
        now={NOW}
      />
    )
    expect(screen.getByText('Off track')).toBeInTheDocument()
    expect(screen.getByText('Last update 5 weeks ago')).toBeInTheDocument()
  })
})
