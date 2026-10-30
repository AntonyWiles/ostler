// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type {
  ProjectTemplateSummary,
  RendererProject,
  SaveProjectTemplateInput
} from '@shared/ostler-api'
import type { ProjectPackage } from '@shared/project-package'
import { SaveTemplateDialog } from '@renderer/components/SaveTemplateDialog'
import { TemplatesGroup } from '@renderer/views/settings/sections/TemplatesGroup'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

const PROJECT: RendererProject = {
  id: 'p1',
  name: 'Summer party',
  path: null,
  color: '#3b82f6',
  enabled: true,
  customIgnorePatterns: [],
  notes: '',
  tags: [],
  addedAt: 0,
  lastActivity: null,
  hasAutomationToken: false
}

function summary(id: string, name: string, source: 'built-in' | 'saved'): ProjectTemplateSummary {
  return {
    id,
    source,
    name,
    description: 'Our plan',
    icon: 'file',
    milestoneCount: 2,
    taskCount: 5,
    firstTasks: ['Book the hall']
  }
}

describe('SaveTemplateDialog', () => {
  it('saves what the person chose to include, with relative dates', async () => {
    const saved: SaveProjectTemplateInput[] = []
    installOstlerApi({
      saveProjectAsTemplate: async (_projectId, input) => {
        saved.push(input)
        return { ok: true, value: summary('t1', input.name, 'saved') }
      }
    })
    let closed = false
    render(
      <ToastProvider>
        <SaveTemplateDialog project={PROJECT} onClose={() => (closed = true)} />
      </ToastProvider>
    )
    expect(screen.getByLabelText('Template name')).toHaveProperty('value', 'Summer party')
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Party plan' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Decisions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))

    await waitFor(() => expect(closed).toBe(true))
    expect(saved[0]).toMatchObject({
      name: 'Party plan',
      relativeDates: true,
      include: { tasks: true, decisions: false, people: false }
    })
  })
})

describe('TemplatesGroup', () => {
  it('lists saved templates and deletes one at once, with undo', async () => {
    let templates = [summary('a', 'Party plan', 'saved'), summary('sample', 'Welcome', 'built-in')]
    const restored: string[] = []
    const pkg = { project: { name: 'Party plan' } } as unknown as ProjectPackage
    installOstlerApi({
      listProjectTemplates: async () => ({ ok: true, value: templates }),
      deleteProjectTemplate: async (id) => {
        templates = templates.filter((template) => template.id !== id)
        return { ok: true, value: pkg }
      },
      restoreProjectTemplate: async (id) => {
        restored.push(id)
        templates = [summary('a', 'Party plan', 'saved'), ...templates]
        return { ok: true, value: templates[0] }
      }
    })
    render(
      <ToastProvider>
        <TemplatesGroup />
      </ToastProvider>
    )
    await waitFor(() => expect(screen.getByText('Party plan')).toBeTruthy())
    // Built-in templates are not the person's to rename or delete.
    expect(screen.queryByText('Welcome')).toBeNull()
    expect(screen.getByText('2 milestones, 5 tasks · Our plan')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Party plan' }))
    await waitFor(() => expect(screen.getByText('No saved templates')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(restored).toEqual(['a']))
    await waitFor(() => expect(screen.getByText('Party plan')).toBeTruthy())
  })
})
