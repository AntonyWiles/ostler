// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  CreatePlanningFieldInput,
  PlanningFieldDefinition,
  PlanningFieldDeletion
} from '@shared/ostler-api'
import { ProjectFieldsManager } from '@renderer/components/ProjectFieldsManager'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

function field(overrides: Partial<PlanningFieldDefinition>): PlanningFieldDefinition {
  return {
    id: 'f1',
    projectId: 'p1',
    name: 'Size',
    type: 'choice',
    options: [{ id: 'o1', name: 'Small', color: '#22c55e' }],
    position: 0,
    createdAt: 0,
    ...overrides
  }
}

/** A fake main process holding the project's fields. */
function setup(initial: PlanningFieldDefinition[]) {
  let fields = [...initial]
  const createPlanningField = vi.fn(async (_projectId: string, input: CreatePlanningFieldInput) => {
    const created = field({
      id: `f${fields.length + 1}`,
      name: input.name,
      type: input.type,
      options: (input.options ?? []).map((option, index) => ({
        id: `n${index}`,
        name: option.name,
        color: option.color ?? '#888888'
      }))
    })
    fields = [...fields, created]
    return { ok: true as const, value: created }
  })
  const deletion: PlanningFieldDeletion = {
    field: initial[0],
    values: [{ workItemId: 'w1', fieldId: initial[0]?.id, value: 'o1' }] as never
  }
  const deletePlanningField = vi.fn(async (_projectId: string, fieldId: string) => {
    fields = fields.filter((candidate) => candidate.id !== fieldId)
    return { ok: true as const, value: deletion }
  })
  const restorePlanningField = vi.fn(async () => {
    fields = [initial[0], ...fields]
    return { ok: true as const, value: initial[0] }
  })
  installOstlerApi({
    getPlanningFields: async () => ({ ok: true, value: fields }),
    createPlanningField,
    deletePlanningField,
    restorePlanningField
  })
  const onSaved = vi.fn()
  render(
    <ToastProvider>
      <ProjectFieldsManager projectId="p1" onError={() => {}} onSaved={onSaved} />
    </ToastProvider>
  )
  return { createPlanningField, deletePlanningField, restorePlanningField, onSaved }
}

describe('ProjectFieldsManager (R2.2)', () => {
  it('says when the project has no fields yet', async () => {
    setup([])
    expect(await screen.findByText(/no fields yet/i)).toBeTruthy()
  })

  it('adds a choice field with its options', async () => {
    const { createPlanningField, onSaved } = setup([])
    fireEvent.click(await screen.findByRole('button', { name: 'Add field' }))
    const form = screen.getByRole('form', { name: 'Add field' })
    fireEvent.change(within(form).getByLabelText('Field name'), { target: { value: 'Team' } })
    fireEvent.change(within(form).getByLabelText(/^Type/), { target: { value: 'choice' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add option' }))
    fireEvent.change(within(form).getByLabelText('Option 1 name'), { target: { value: 'Web' } })
    fireEvent.submit(form)
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(createPlanningField).toHaveBeenCalledWith('p1', {
      name: 'Team',
      type: 'choice',
      options: [expect.objectContaining({ name: 'Web' })]
    })
    expect(await screen.findByText('Team')).toBeTruthy()
  })

  it('a field cannot change type once made', async () => {
    setup([field({})])
    fireEvent.click(await screen.findByRole('button', { name: 'Edit field Size' }))
    const form = screen.getByRole('form', { name: 'Edit field Size' })
    expect(within(form).queryByLabelText(/^Type/)).toBeNull()
  })

  it('keeps an option colour from outside the palette as it is', async () => {
    setup([field({ options: [{ id: 'o1', name: 'Small', color: '#123456' }] })])
    fireEvent.click(await screen.findByRole('button', { name: 'Edit field Size' }))
    expect(screen.getByLabelText('Colour of Small')).toHaveValue('#123456')
  })

  it('deletes a field at once, and Undo puts it back with its values', async () => {
    const { deletePlanningField, restorePlanningField } = setup([field({})])
    fireEvent.click(await screen.findByRole('button', { name: 'Delete field Size' }))
    await waitFor(() => expect(deletePlanningField).toHaveBeenCalledWith('p1', 'f1'))
    await waitFor(() => expect(screen.queryByText('Size')).toBeNull())
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(restorePlanningField).toHaveBeenCalled())
    expect(await screen.findByText('Size')).toBeTruthy()
  })
})
