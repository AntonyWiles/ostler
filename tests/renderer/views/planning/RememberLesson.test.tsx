// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HarnessReviewComment, RendererProject } from '@shared/ostler-api'
import {
  LessonOfferHost,
  offerLesson,
  offerLessonAfterSendBack
} from '@renderer/views/planning/RememberLesson'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

const project = {
  id: 'p1',
  name: 'Garden',
  path: null,
  color: '#3b82f6',
  enabled: true,
  customIgnorePatterns: [],
  notes: '',
  tags: [],
  addedAt: 0,
  lastActivity: null,
  hasAutomationToken: false,
  agentLessons: []
} satisfies RendererProject

const comment: HarnessReviewComment = {
  id: 'c1',
  file: 'src/app.ts',
  side: 'new',
  firstLine: 4,
  lastLine: 4,
  comment: 'Use formatDate from src/shared/format.ts, never a new helper.'
}

function setup() {
  const updateProject = vi.fn(async (_id: string, updates: Partial<RendererProject>) => ({
    ok: true as const,
    value: { ...project, ...updates }
  }))
  installOstlerApi({ getProjects: async () => ({ ok: true, value: [project] }), updateProject })
  const view = render(
    <ToastProvider>
      <LessonOfferHost />
    </ToastProvider>
  )
  return { updateProject, view }
}

function sendBack(reason: string, comments: HarnessReviewComment[]) {
  act(() =>
    offerLessonAfterSendBack(
      'p1',
      { id: 's1', title: 'Session title' },
      { title: 'Fix the login' },
      reason,
      comments
    )
  )
}

afterEach(() => vi.restoreAllMocks())

describe('Remember this for next time (N9.6a)', () => {
  it('offers a lesson in the toast after a Send back with a reason', async () => {
    setup()
    sendBack('Tests go beside the file.', [])
    expect(
      await screen.findByRole('button', { name: 'Remember this for next time' })
    ).toBeInTheDocument()
  })

  it('offers nothing after a Send back with no reason and no comments', () => {
    setup()
    sendBack('   ', [])
    expect(screen.queryByRole('button', { name: 'Remember this for next time' })).toBeNull()
  })

  it('drafts the lesson from the reason, offers each comment instead, and saves what the person saves', async () => {
    const { updateProject } = setup()
    sendBack('Wrong date helper', [comment])
    fireEvent.click(await screen.findByRole('button', { name: 'Remember this for next time' }))
    const field = await screen.findByRole('textbox', { name: 'Lesson' })
    expect(field).toHaveValue('Wrong date helper')
    expect(field).toHaveAccessibleDescription(/Write it as a rule for any task/)
    expect(screen.getByText('src/app.ts, line 4', { exact: false })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Use this comment/ }))
    expect(field).toHaveValue(comment.comment)
    fireEvent.change(field, { target: { value: 'Use formatDate for every date.' } })
    expect(updateProject).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save lesson' }))
    await waitFor(() => expect(updateProject).toHaveBeenCalledTimes(1))
    const [, updates] = updateProject.mock.calls[0]
    expect(updates.agentLessons).toEqual([
      expect.objectContaining({
        text: 'Use formatDate for every date.',
        enabled: true,
        source: { sessionId: 's1', taskTitle: 'Fix the login' }
      })
    ])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByText('Lesson saved')).toBeInTheDocument()
  })

  it('saves nothing when the person cancels', async () => {
    const { updateProject } = setup()
    act(() =>
      offerLesson({
        projectId: 'p1',
        sessionId: 's1',
        taskTitle: 'Fix the login',
        reason: '',
        comments: [comment]
      })
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Remember this for next time' }))
    expect(await screen.findByRole('textbox', { name: 'Lesson' })).toHaveValue(comment.comment)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(updateProject).not.toHaveBeenCalled()
  })

  it('will not save an empty lesson', async () => {
    setup()
    sendBack('Reason', [])
    fireEvent.click(await screen.findByRole('button', { name: 'Remember this for next time' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Lesson' }), {
      target: { value: '  ' }
    })
    expect(screen.getByRole('button', { name: 'Save lesson' })).toBeDisabled()
  })
})
