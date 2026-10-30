// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectStateUpdate, RendererProject } from '@shared/ostler-api'
import { OstlerProvider, useOstler } from '@renderer/context/OstlerContext'
import { installOstlerApi } from '../fixtures/ostler-api'
import { makeHarnessState } from '../fixtures/planning-records'

const project = (id: string, enabled = true) =>
  ({ id, name: `Project ${id}`, enabled }) as unknown as RendererProject

function Probe() {
  const { projects, loading } = useOstler()
  return <p>{loading ? 'loading' : projects.map((item) => item.id).join(',')}</p>
}

function setup() {
  const listeners = new Set<(update: ProjectStateUpdate) => void>()
  const getProjects = vi.fn(async () => ({
    ok: true as const,
    value: [project('p1'), project('off', false)]
  }))
  const getWatcherStatus = vi.fn(async () => ({
    ok: true as const,
    value: { running: true, projects: [] }
  }))
  installOstlerApi({
    getProjects,
    getWatcherStatus,
    onProjectStateChange: (callback) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    }
  })
  const push = (update: ProjectStateUpdate) =>
    act(() => {
      for (const listener of [...listeners]) listener(update)
    })
  return { getProjects, getWatcherStatus, push }
}

async function renderProvider() {
  const env = setup()
  render(
    <OstlerProvider>
      <Probe />
    </OstlerProvider>
  )
  await screen.findByText('p1')
  await waitFor(() => expect(env.getWatcherStatus).toHaveBeenCalledTimes(1))
  env.getProjects.mockClear()
  env.getWatcherStatus.mockClear()
  return env
}

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))

describe('OstlerContext refreshes', () => {
  it('loads projects (enabled only) and the watcher status on first load', async () => {
    await renderProvider()
    expect(screen.getByText('p1')).toBeInTheDocument()
  })

  it('does not re-read projects or the watcher for a harness push', async () => {
    const { getProjects, getWatcherStatus, push } = await renderProvider()
    push({ projectId: 'p1', field: 'harness', data: makeHarnessState() })
    push({ projectId: 'p1', field: 'planning', data: null })
    await flush()
    expect(getProjects).not.toHaveBeenCalled()
    expect(getWatcherStatus).not.toHaveBeenCalled()
  })

  it('re-reads projects for a projects push', async () => {
    const { getProjects, getWatcherStatus, push } = await renderProvider()
    push({ projectId: 'p1', field: 'projects', data: null })
    await waitFor(() => expect(getProjects).toHaveBeenCalledTimes(1))
    expect(getWatcherStatus).not.toHaveBeenCalled()
  })

  it('re-reads only the watcher status for a watcher push', async () => {
    const { getProjects, getWatcherStatus, push } = await renderProvider()
    push({ projectId: 'p1', field: 'watcher', data: null })
    await waitFor(() => expect(getWatcherStatus).toHaveBeenCalledTimes(1))
    expect(getProjects).not.toHaveBeenCalled()
  })
})
