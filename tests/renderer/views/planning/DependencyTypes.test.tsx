// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PlanningDependencyLink, PlanningWorkItem } from '@shared/ostler-api'
import { TaskDependencies } from '@renderer/views/planning/TaskDependencies'
import {
  dependencyConflictWords,
  dependencyLinkWords
} from '@renderer/views/planning/dependency-link-words'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { makeWorkItem } from '../../fixtures/planning-records'

const link = (type: PlanningDependencyLink['type'], lagDays: number): PlanningDependencyLink => ({
  id: 'plaster',
  type,
  lagDays
})

describe('a waits-on link in words (N7.2a)', () => {
  it('says each type with no lag, a lag after and a lead before', () => {
    expect(dependencyLinkWords(link('finish-to-start', 0), 'Plastering')).toBe(
      'Starts when Plastering is due'
    )
    expect(dependencyLinkWords(link('start-to-start', 2), 'Plastering')).toBe(
      'Starts 2 days after Plastering starts'
    )
    expect(dependencyLinkWords(link('finish-to-start', -1), 'Plastering')).toBe(
      'Starts 1 day before Plastering is due'
    )
    expect(dependencyLinkWords(link('finish-to-finish', 0), 'Data')).toBe('Due when Data is due')
    expect(dependencyLinkWords(link('finish-to-finish', 3), 'Data')).toBe(
      'Due 3 days after Data is due'
    )
  })

  it('keeps a plain link’s conflict words and says what a typed link asks for', () => {
    expect(dependencyConflictWords('Plastering', link('finish-to-start', 0))).toBeNull()
    expect(dependencyConflictWords('Plastering', {})).toBeNull()
    expect(dependencyConflictWords('Plastering', link('start-to-start', 2))).toBe(
      'Too early: Starts 2 days after Plastering starts'
    )
  })
})

describe('the drawer’s link editor (N7.2a)', () => {
  function setup(links: PlanningDependencyLink[]) {
    const plaster = makeWorkItem('plaster', { title: 'Plastering' })
    const paint = makeWorkItem('paint', {
      title: 'Painting',
      dependencyIds: links.map((entry) => entry.id),
      dependencyLinks: links
    })
    const items = [plaster, paint]
    const setEditDependencyLink = vi.fn()
    const ws = {
      workItems: items,
      workItemsById: new Map(items.map((item) => [item.id, item])),
      projectedStatus: (item: PlanningWorkItem) => item.status,
      editDependencyIds: paint.dependencyIds,
      editDependencyLinks: links,
      setEditDependencyIds: vi.fn(),
      setEditDependencyLink
    } as unknown as PlanningWorkspace
    const view = render(<TaskDependencies ws={ws} item={paint} openTask={() => {}} />)
    return { ...view, setEditDependencyLink }
  }

  it('shows each link in words, with the help on what holds work back', () => {
    setup([link('start-to-start', 2)])
    expect(screen.getByText('Starts 2 days after Plastering starts')).toBeTruthy()
    expect(screen.getByText(/holds this task back from Ready and the agent queue/)).toBeTruthy()
  })

  it('opens the editor from a named button, then changes the type and the lag by keyboard', () => {
    const { setEditDependencyLink } = setup([link('finish-to-start', 0)])
    const edit = screen.getByRole('button', { name: 'Change how this task waits on Plastering' })
    expect(edit.getAttribute('aria-expanded')).toBe('false')
    edit.focus()
    expect(document.activeElement).toBe(edit)
    fireEvent.click(edit)
    expect(edit.getAttribute('aria-expanded')).toBe('true')

    const type = screen.getByRole('combobox', { name: 'How it waits' }) as HTMLSelectElement
    expect(type.value).toBe('finish-to-start')
    type.focus()
    expect(document.activeElement).toBe(type)
    fireEvent.change(type, { target: { value: 'start-to-start' } })
    expect(setEditDependencyLink).toHaveBeenLastCalledWith(
      'plaster',
      { type: 'start-to-start' },
      undefined
    )

    const lag = screen.getByRole('spinbutton', { name: /Days after/ }) as HTMLInputElement
    expect(lag.value).toBe('0')
    lag.focus()
    expect(document.activeElement).toBe(lag)
    fireEvent.change(lag, { target: { value: '-2' } })
    expect(setEditDependencyLink).toHaveBeenLastCalledWith('plaster', { lagDays: -2 }, true)
    // Out of range or not whole is not saved.
    setEditDependencyLink.mockClear()
    fireEvent.change(lag, { target: { value: '400' } })
    fireEvent.change(lag, { target: { value: '1.5' } })
    expect(setEditDependencyLink).not.toHaveBeenCalled()
  })
})
