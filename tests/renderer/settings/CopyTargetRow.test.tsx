// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectedAccount } from '@shared/ostler-api'
import {
  CopyTargetRow,
  MY_TASKS_INTO_LIST,
  TIME_BLOCKS_INTO_CALENDAR
} from '@renderer/views/settings/sections/CopyTargetRow'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

const account: ConnectedAccount = {
  id: 'a1',
  provider: 'microsoft',
  label: 'ann@example.com',
  server: null,
  capabilities: ['calendar.write', 'tasks.sync'],
  status: 'connected',
  failure: null,
  createdAt: 1,
  lastUsedAt: null
}

const wrap = (node: React.ReactNode) =>
  render(
    <ToastProvider>
      <ConfirmProvider>{node}</ConfirmProvider>
    </ToastProvider>
  )

describe('writing back (integrations phase 6)', () => {
  it('chooses a task list for my tasks', async () => {
    const setTaskListTarget = vi.fn(async () => ({
      ok: true as const,
      value: {
        accountId: 'a1',
        name: 'Tasks',
        syncedAt: null,
        failedAt: null,
        failure: null
      }
    }))
    installOstlerApi({
      getTaskListTarget: async () => ({ ok: true, value: null }),
      listTaskLists: async () => ({ ok: true, value: [{ remoteId: 'l1', name: 'Tasks' }] }),
      setTaskListTarget
    })
    wrap(<CopyTargetRow kind={MY_TASKS_INTO_LIST} accounts={[account]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a list…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Copy my tasks into a list' })
    await within(dialog).findByRole('combobox', { name: 'List' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(setTaskListTarget).toHaveBeenCalledWith({
        accountId: 'a1',
        remoteId: 'l1',
        name: 'Tasks'
      })
    )
    expect(
      await screen.findByText(
        /Copied into Tasks \(Microsoft 365 or Outlook\.com · ann@example\.com\)/
      )
    ).toBeTruthy()
  })

  it('says why copying time blocks failed, and stops after asking', async () => {
    const setCalendarWriteTarget = vi.fn(async () => ({ ok: true as const, value: null }))
    installOstlerApi({
      getCalendarWriteTarget: async () => ({
        ok: true,
        value: {
          accountId: 'a1',
          name: 'Calendar',
          syncedAt: 1,
          failedAt: Date.now(),
          failure: 'expired'
        }
      }),
      setCalendarWriteTarget
    })
    wrap(<CopyTargetRow kind={TIME_BLOCKS_INTO_CALENDAR} accounts={[account]} />)
    expect(await screen.findByText(/Sign in again/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Stop copying time blocks?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(setCalendarWriteTarget).toHaveBeenCalledWith(null))
  })
})
