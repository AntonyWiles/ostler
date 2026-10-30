// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectStateUpdate, RendererProject } from '@shared/ostler-api'
import {
  forgetPortfolioSummaries,
  usePortfolioSummary
} from '@renderer/views/planning/usePortfolioSummary'
import { installOstlerApi } from '../../fixtures/ostler-api'

const project = (id: string) => ({ id, name: id.toUpperCase(), enabled: true }) as RendererProject
const projects = [project('alpha'), project('beta'), project('gamma')]

function fakeApi() {
  let push: ((update: ProjectStateUpdate) => void) | null = null
  const getPlanningWorkItems = vi.fn(async (_projectId: string) => ({
    ok: true as const,
    value: []
  }))
  installOstlerApi({
    getPlanningWorkItems,
    getPlanningMilestones: async () => ({ ok: true, value: [] }),
    getPlanningProjectMetrics: async () => ({ ok: true, value: {} as never }),
    getHarnessState: async () => ({ ok: false, error: 'off' }),
    getPlanningProjectWorkItemMetrics: async () => ({ ok: true, value: {} }),
    onProjectStateChange: (callback) => {
      push = callback
      return () => {}
    }
  })
  const read = () => getPlanningWorkItems.mock.calls.map(([id]) => id)
  return { read, push: (update: ProjectStateUpdate) => act(() => push?.(update)) }
}

describe("Home's project summaries", () => {
  afterEach(() => forgetPortfolioSummaries())

  it('are not read again on the next visit when nothing changed', async () => {
    const api = fakeApi()
    const first = renderHook(() => usePortfolioSummary(projects))
    await waitFor(() => expect(first.result.current.summary).not.toBeNull())
    first.unmount()
    expect(api.read()).toEqual(['alpha', 'beta', 'gamma'])

    const second = renderHook(() => usePortfolioSummary(projects))
    await waitFor(() => expect(second.result.current.summary).not.toBeNull())
    expect(second.result.current.summary?.projects.map((p) => p.projectName)).toEqual([
      'ALPHA',
      'BETA',
      'GAMMA'
    ])
    expect(api.read()).toHaveLength(3)
  })

  it('read again only the project a change was in, even one made while Home was closed', async () => {
    const api = fakeApi()
    const first = renderHook(() => usePortfolioSummary(projects))
    await waitFor(() => expect(first.result.current.summary).not.toBeNull())
    first.unmount()
    api.push({ projectId: 'beta', field: 'planning', data: null })

    const second = renderHook(() => usePortfolioSummary(projects))
    await waitFor(() => expect(api.read()).toHaveLength(4))
    expect(api.read()[3]).toBe('beta')
    // Something Home shows changed anywhere: every project is read again, at once.
    api.push({ projectId: '', field: 'home', data: null })
    await waitFor(() => expect(api.read()).toHaveLength(7))
    second.unmount()
  })

  it('reads one project at a time and stops when Home closes', async () => {
    const api = fakeApi()
    // Main answers only when the test says so.
    const waiting: Array<() => void> = []
    const answered = window.ostlerAPI.getPlanningWorkItems
    window.ostlerAPI.getPlanningWorkItems = (projectId) =>
      new Promise((resolve) => waiting.push(() => resolve(answered(projectId))))
    const view = renderHook(() => usePortfolioSummary(projects))
    await waitFor(() => expect(waiting).toHaveLength(1))
    // Nothing asked of the next project while the first is being read.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(waiting).toHaveLength(1)
    view.unmount()
    await act(async () => waiting[0]())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(waiting).toHaveLength(1)
    expect(api.read()).toEqual(['alpha'])
  })
})
