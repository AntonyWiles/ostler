// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useFlushOnQuit, useFlushOnQuitChannel } from '@renderer/shell/flush-on-quit'
import { installOstlerApi } from '../fixtures/ostler-api'

describe('saving on quit (R1.5)', () => {
  it('answers main once every registered edit is saved, and forgets one unmounted', async () => {
    let ask!: (requestId: number) => void
    const editsFlushed = vi.fn(async () => ({ ok: true as const, value: undefined }))
    installOstlerApi({
      onFlushEdits: (callback) => {
        ask = callback
        return () => {}
      },
      editsFlushed
    })
    let release!: () => void
    const saving = new Promise<void>((resolve) => (release = resolve))
    const drawer = vi.fn(() => saving)
    const gone = vi.fn(async () => {})
    renderHook(() => useFlushOnQuitChannel())
    renderHook(() => useFlushOnQuit(drawer))
    renderHook(() => useFlushOnQuit(gone)).unmount()

    ask(7)
    expect(drawer).toHaveBeenCalledOnce()
    expect(gone).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(editsFlushed).not.toHaveBeenCalled()
    release()
    await waitFor(() => expect(editsFlushed).toHaveBeenCalledWith(7))
  })
})
