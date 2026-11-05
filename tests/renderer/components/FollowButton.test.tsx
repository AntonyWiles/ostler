// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FollowButton } from '@renderer/views/planning/FollowButton'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

describe('the Follow button (prompt 15)', () => {
  it('shows Following when the task is followed and unfollows on a click', async () => {
    const setTaskFollow = vi.fn(async (_p: string, _t: string, following: boolean) => ({
      ok: true as const,
      value: following
    }))
    installOstlerApi({
      getTaskFollow: vi.fn(async () => ({ ok: true as const, value: true })),
      setTaskFollow
    })
    render(<FollowButton projectId="p-1" taskId="t-1" />)

    const button = await screen.findByRole('button', { name: 'Following' })
    expect(button.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(button)
    const unfollowed = await screen.findByRole('button', { name: 'Follow' })
    expect(unfollowed.getAttribute('aria-pressed')).toBe('false')
    expect(setTaskFollow).toHaveBeenCalledWith('p-1', 't-1', false)
  })
})

describe('the Follow button says what it did', () => {
  it('reads Unfollow while pointed at, and says when a change fails', async () => {
    installOstlerApi({
      getTaskFollow: vi.fn(async () => ({ ok: true as const, value: true })),
      setTaskFollow: vi.fn(async () => ({ ok: false as const, error: 'Disk is full' }))
    })
    render(
      <ToastProvider>
        <FollowButton projectId="p-1" taskId="t-1" />
      </ToastProvider>
    )
    const button = await screen.findByRole('button', { name: 'Following' })
    fireEvent.mouseEnter(button)
    expect(button.textContent).toContain('Unfollow')

    fireEvent.click(button)
    expect(await screen.findByText("Couldn't stop following this task")).toBeTruthy()
    expect(screen.getByText('Disk is full')).toBeTruthy()
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('the Follow button toast', () => {
  it('says following stopped, and Undo follows again', async () => {
    const setTaskFollow = vi.fn(async (_p: string, _t: string, following: boolean) => ({
      ok: true as const,
      value: following
    }))
    installOstlerApi({
      getTaskFollow: vi.fn(async () => ({ ok: true as const, value: true })),
      setTaskFollow
    })
    render(
      <ToastProvider>
        <FollowButton projectId="p-1" taskId="t-1" />
      </ToastProvider>
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Following' }))
    expect(await screen.findByText('Stopped following this task')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByRole('button', { name: 'Following' })).toBeTruthy()
    expect(setTaskFollow).toHaveBeenLastCalledWith('p-1', 't-1', true)
  })
})
