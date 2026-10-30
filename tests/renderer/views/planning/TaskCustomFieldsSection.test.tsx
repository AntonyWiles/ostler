// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanningFieldDefinition } from '@shared/ostler-api'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { TaskCustomFieldsSection } from '@renderer/views/planning/TaskCustomFieldsSection'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'

const FIELDS: PlanningFieldDefinition[] = [
  {
    id: 'f1',
    projectId: 'p1',
    name: 'Notes',
    type: 'text',
    options: [],
    position: 0,
    createdAt: 0
  },
  {
    id: 'f2',
    projectId: 'p1',
    name: 'Signed off',
    type: 'checkbox',
    options: [],
    position: 1,
    createdAt: 0
  },
  {
    id: 'f3',
    projectId: 'p1',
    name: 'Size',
    type: 'choice',
    options: [{ id: 'o1', name: 'Small', color: '#22c55e' }],
    position: 2,
    createdAt: 0
  }
]

let base: PlanningWorkspace
beforeEach(async () => {
  base = await renderPlanningWorkspace()
})

describe('TaskCustomFieldsSection (R2.2)', () => {
  it('is not there when the project has no fields', () => {
    const { container } = render(
      <TaskCustomFieldsSection ws={withWorkspace(base, { fields: [] })} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("shows each field with the task's value, and saves typing after a pause and picks at once", () => {
    const setEditFieldValue = vi.fn()
    render(
      <TaskCustomFieldsSection
        ws={withWorkspace(base, {
          fields: FIELDS,
          editFieldValues: { f1: 'Ask Ada', f3: 'o1' },
          setEditFieldValue,
          saveFailures: []
        })}
      />
    )
    expect(screen.getByLabelText('Notes')).toHaveValue('Ask Ada')
    expect(screen.getByLabelText('Size')).toHaveValue('o1')
    expect(screen.getByLabelText('Signed off')).not.toBeChecked()

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Ask Grace' } })
    expect(setEditFieldValue).toHaveBeenLastCalledWith('f1', 'Ask Grace', true)
    fireEvent.click(screen.getByLabelText('Signed off'))
    expect(setEditFieldValue).toHaveBeenLastCalledWith('f2', true, false)
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '' } })
    expect(setEditFieldValue).toHaveBeenLastCalledWith('f3', null, false)
  })

  it('shows a failed save under the field it belongs to', () => {
    render(
      <TaskCustomFieldsSection
        ws={withWorkspace(base, {
          fields: FIELDS,
          editFieldValues: {},
          saveFailures: [{ field: 'custom:f1', message: 'That is too long' }] as never
        })}
      />
    )
    expect(screen.getByText('That is too long')).toBeTruthy()
  })
})
