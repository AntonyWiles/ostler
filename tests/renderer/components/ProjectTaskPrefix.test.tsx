// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RendererProject } from '@shared/ostler-api'
import { ProjectTaskPrefix } from '@renderer/components/ProjectTaskPrefix'
import { installOstlerApi } from '../fixtures/ostler-api'

/** Project settings › Task IDs (N9.8a): Change prefix, with what it does said first. */

const project = { id: 'p1', name: 'Shop', taskPrefix: 'SHO' } as RendererProject

describe('ProjectTaskPrefix', () => {
  it('shows the prefix and changes it, made capital, after saying old IDs stop matching', async () => {
    const updateProject = vi.fn(async (_id: string, updates: Partial<RendererProject>) => ({
      ok: true as const,
      value: { ...project, ...updates } as RendererProject
    }))
    installOstlerApi({ updateProject })
    const onSaved = vi.fn()
    render(<ProjectTaskPrefix project={project} onSaved={onSaved} />)
    expect(screen.getByText(/SHO-12/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Change prefix' }))
    expect(screen.getByText(/Old IDs in commits and notes will no longer match/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Prefix'), { target: { value: 'shop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save prefix' }))
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('p1', { taskPrefix: 'SHOP' }))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ taskPrefix: 'SHOP' }))
  })

  it('refuses a prefix that is not two to five letters before asking main', () => {
    const updateProject = vi.fn()
    installOstlerApi({ updateProject })
    render(<ProjectTaskPrefix project={project} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change prefix' }))
    fireEvent.change(screen.getByLabelText('Prefix'), { target: { value: 'S1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save prefix' }))
    expect(screen.getByText('A prefix is two to five letters, A to Z.')).toBeTruthy()
    expect(updateProject).not.toHaveBeenCalled()
  })

  it("shows main's refusal of a prefix another project uses", async () => {
    installOstlerApi({
      updateProject: async () => ({
        ok: false,
        error: '“Garden” already uses that prefix. Choose another.'
      })
    })
    render(<ProjectTaskPrefix project={project} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change prefix' }))
    fireEvent.change(screen.getByLabelText('Prefix'), { target: { value: 'GAR' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save prefix' }))
    expect(await screen.findByText(/already uses that prefix/)).toBeTruthy()
  })
})
