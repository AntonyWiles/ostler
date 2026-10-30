// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SendGuidanceButton } from '@renderer/views/planning/SendGuidance'
import { ToastProvider } from '@renderer/ui'
import type { HarnessGuidance, HarnessProjectState, HarnessSession } from '@shared/ostler-api'
import { installOstlerApi } from '../../fixtures/ostler-api'

const session: HarnessSession = {
  id: 'sess-1',
  title: 'Write the parser',
  startedAt: new Date().toISOString(),
  lastUpdate: new Date().toISOString(),
  statusNote: '',
  status: 'active',
  blocked: false,
  workspace: null,
  token: '',
  lastSeenAt: null,
  provenance: 'external'
}

const earlier: HarnessGuidance = {
  id: 'g1',
  sessionId: 'sess-1',
  text: 'Keep the **old** tests.',
  from: 'Sam',
  via: 'app',
  sentAt: new Date().toISOString(),
  deliveredAt: null
}

function renderButton(target: HarnessSession = session) {
  return render(
    <ToastProvider>
      <SendGuidanceButton projectId="p1" session={target} runTitle="Write the parser" />
    </ToastProvider>
  )
}

describe('SendGuidanceButton', () => {
  it('is not offered on a run that has finished', () => {
    installOstlerApi()
    renderButton({ ...session, status: 'done' })
    expect(screen.queryByRole('button', { name: /send guidance/i })).toBeNull()
  })

  it('lists what was sent with its delivered state, and sends a new message', async () => {
    const sendHarnessGuidance = vi.fn(async () => ({
      ok: true as const,
      value: { ...earlier, id: 'g2', text: 'Only cover the new parser.' }
    }))
    installOstlerApi({
      getHarnessState: async () => ({
        ok: true,
        value: { guidance: [earlier] } as unknown as HarnessProjectState
      }),
      sendHarnessGuidance
    })
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Send guidance to Write the parser' }))
    const dialog = await screen.findByRole('dialog')
    expect(await screen.findByText('Waiting for the agent')).toBeTruthy()
    expect(dialog.querySelector('strong')?.textContent).toBe('old')

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Only cover the new parser.' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(sendHarnessGuidance).toHaveBeenCalledWith('p1', 'sess-1', 'Only cover the new parser.')
    )
    expect(
      await screen.findByText('Guidance sent. The agent gets it when it next reads its session.')
    ).toBeTruthy()
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('')
  })

  it('shows a refusal in place', async () => {
    installOstlerApi({
      getHarnessState: async () => ({
        ok: true,
        value: { guidance: [] } as unknown as HarnessProjectState
      }),
      sendHarnessGuidance: async () => ({
        ok: false as const,
        error: 'This run is no longer running, so the message was not sent.'
      })
    })
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: 'Send guidance to Write the parser' }))
    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(
      await screen.findByText('This run is no longer running, so the message was not sent.')
    ).toBeTruthy()
  })
})
