// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectWebhook, RendererProject } from '@shared/ostler-api'
import { ProjectWebhooksPanel } from '@renderer/components/ProjectWebhooksPanel'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

const project = { id: 'p1', name: 'Launch' } as RendererProject

const hook: ProjectWebhook = {
  id: 'w1',
  projectId: 'p1',
  kind: 'slack',
  name: 'Team',
  shown: 'hooks.slack.com/…',
  events: ['statusUpdate', 'milestoneDone'],
  createdAt: 1,
  lastSentAt: null,
  failedAt: Date.now() - 60_000,
  failure: 'refused'
}

const renderPanel = () =>
  render(
    <ToastProvider>
      <ConfirmProvider>
        <ProjectWebhooksPanel project={project} />
      </ConfirmProvider>
    </ToastProvider>
  )

describe('Project settings › Sharing › Tell the team (integrations phase 4)', () => {
  it('lists channels with what they post and why the last post failed', async () => {
    const testWebhook = vi.fn(async () => ({
      ok: true as const,
      value: { ...hook, failure: null, failedAt: null, lastSentAt: Date.now() }
    }))
    installOstlerApi({ listWebhooks: async () => ({ ok: true, value: [hook] }), testWebhook })
    renderPanel()
    expect(await screen.findByText('Team · Slack')).toBeTruthy()
    expect(screen.getByText(/Status updates, Milestones done/)).toBeTruthy()
    expect(screen.getByText(/The address was refused/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send a test to Team' }))
    await waitFor(() => expect(testWebhook).toHaveBeenCalledWith('w1'))
  })

  it('adds a Teams channel with the address and the events chosen', async () => {
    const addWebhook = vi.fn(async () => ({ ok: true as const, value: hook }))
    installOstlerApi({ listWebhooks: async () => ({ ok: true, value: [] }), addWebhook })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Add a channel…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a channel' })
    expect(
      within(dialog).getByText(/Post to a channel when a webhook request is received/)
    ).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Address'), {
      target: { value: 'https://prod-1.westus.logic.azure.com/workflows/x' }
    })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Reviews waiting' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(addWebhook).toHaveBeenCalledWith({
        projectId: 'p1',
        kind: 'teams',
        name: 'Microsoft Teams',
        url: 'https://prod-1.westus.logic.azure.com/workflows/x',
        events: ['statusUpdate', 'milestoneDone']
      })
    )
  })
})
