// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FollowButton } from '@renderer/views/planning/FollowButton'
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
