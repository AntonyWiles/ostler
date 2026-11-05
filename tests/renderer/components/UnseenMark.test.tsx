// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkAllSeenButton, UnseenMark } from '@renderer/views/planning/UnseenMark'
import { useUnseenTasks } from '@renderer/hooks/planning/useUnseenTasks'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { installOstlerApi } from '../fixtures/ostler-api'

describe('new and changed marks (MOP-82)', () => {
  it('names the mark for assistive technology', () => {
    const { rerender } = render(<UnseenMark kind="new" />)
    expect(screen.getByRole('img', { name: 'New' })).toBeTruthy()
    rerender(<UnseenMark kind="changed" />)
    expect(screen.getByRole('img', { name: 'Changed' })).toBeTruthy()
    rerender(<UnseenMark kind={undefined} />)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('offers Mark all as seen only while a task is marked', () => {
    const markAllTasksSeen = vi.fn(async () => {})
    const ws = { unseenTasks: { 't-1': 'new' }, markAllTasksSeen } as unknown as PlanningWorkspace
    const { rerender } = render(<MarkAllSeenButton ws={ws} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as seen' }))
    expect(markAllTasksSeen).toHaveBeenCalled()
    rerender(<MarkAllSeenButton ws={{ ...ws, unseenTasks: {} }} />)
    expect(screen.queryByRole('button', { name: 'Mark all as seen' })).toBeNull()
  })

  it('clears the mark of the task opened in the drawer', async () => {
    const markTasksSeen = vi.fn(async () => ({ ok: true as const, value: undefined }))
    installOstlerApi({
      getUnseenTasks: vi.fn(async () => ({
        ok: true as const,
        value: { 't-1': 'new' as const, 't-2': 'changed' as const }
      })),
      markTasksSeen
    })
    const items: never[] = []
    const { result, rerender } = renderHook(
      ({ open }: { open: string | null }) => useUnseenTasks('p-1', items, open),
      { initialProps: { open: null as string | null } }
    )
    await waitFor(() => expect(Object.keys(result.current.unseenTasks)).toHaveLength(2))
    await act(async () => rerender({ open: 't-1' }))
    expect(result.current.unseenTasks).toEqual({ 't-2': 'changed' })
    expect(markTasksSeen).toHaveBeenCalledWith(['t-1'])
  })
})
