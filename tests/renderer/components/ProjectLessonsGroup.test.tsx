// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectLesson, RendererProject } from '@shared/ostler-api'
import { ProjectLessonsGroup } from '@renderer/components/ProjectLessonsGroup'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

const lessons: ProjectLesson[] = [
  {
    id: 'a',
    text: 'Use formatDate for dates.',
    enabled: true,
    addedAt: new Date(2026, 9, 3, 12).getTime(),
    source: { sessionId: 's1', taskTitle: 'Fix the login' }
  },
  {
    id: 'b',
    text: 'Tests go beside the file.',
    enabled: false,
    addedAt: new Date(2026, 9, 5, 12).getTime(),
    source: null
  }
]

const base = {
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
  agentConventions: '# Rules',
  agentLessons: lessons
} satisfies RendererProject

function Harness() {
  const [project, setProject] = useState<RendererProject>(base)
  return <ProjectLessonsGroup project={project} onSaved={setProject} setError={() => undefined} />
}

function setup() {
  let current: RendererProject = base
  const updateProject = vi.fn(async (_id: string, updates: Partial<RendererProject>) => {
    current = { ...current, ...updates }
    return { ok: true as const, value: current }
  })
  installOstlerApi({ updateProject })
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>
  )
  return updateProject
}

describe('Project settings › Lessons (N9.6a)', () => {
  it('lists each lesson with its text, source and date', () => {
    setup()
    expect(screen.getByText('Use formatDate for dates.')).toBeInTheDocument()
    expect(screen.getByText(/From sending back “Fix the login”, 3 October/)).toBeInTheDocument()
    expect(screen.getByText(/Added 5 October/)).toBeInTheDocument()
  })

  it('turns a lesson off with its switch', async () => {
    const updateProject = setup()
    fireEvent.click(screen.getByRole('switch', { name: /Use formatDate for dates/ }))
    await waitFor(() => expect(updateProject).toHaveBeenCalled())
    expect(updateProject.mock.calls[0][1].agentLessons?.[0].enabled).toBe(false)
  })

  it('edits a lesson', async () => {
    const updateProject = setup()
    fireEvent.click(screen.getByRole('button', { name: /^Edit: Use formatDate/ }))
    const field = screen.getByRole('textbox', { name: 'Edit lesson' })
    fireEvent.change(field, { target: { value: 'Use formatDate, always.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText('Use formatDate, always.')).toBeInTheDocument())
    expect(updateProject.mock.calls[0][1].agentLessons?.[0].text).toBe('Use formatDate, always.')
  })

  it('moves a lesson into the conventions, with undo', async () => {
    const updateProject = setup()
    fireEvent.click(screen.getByRole('button', { name: /^Move into conventions: Use formatDate/ }))
    await waitFor(() => expect(screen.queryByText('Use formatDate for dates.')).toBeNull())
    expect(updateProject.mock.calls[0][1]).toEqual({
      agentConventions: '# Rules\n- Use formatDate for dates.\n',
      agentLessons: [lessons[1]]
    })
    expect(await screen.findByText('Moved into conventions')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByText('Use formatDate for dates.')).toBeInTheDocument())
    expect(updateProject.mock.calls[1][1]).toEqual({
      agentConventions: '# Rules',
      agentLessons: lessons
    })
  })

  it('deletes a lesson, with undo', async () => {
    const updateProject = setup()
    fireEvent.click(screen.getByRole('button', { name: /^Delete: Tests go beside/ }))
    await waitFor(() => expect(screen.queryByText('Tests go beside the file.')).toBeNull())
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByText('Tests go beside the file.')).toBeInTheDocument())
    expect(updateProject).toHaveBeenLastCalledWith('p1', { agentLessons: lessons })
  })

  it('says when there are none', () => {
    installOstlerApi({})
    render(
      <ToastProvider>
        <ProjectLessonsGroup
          project={{ ...base, agentLessons: [] }}
          onSaved={() => undefined}
          setError={() => undefined}
        />
      </ToastProvider>
    )
    expect(screen.getByText(/No lessons yet/)).toBeInTheDocument()
  })
})
