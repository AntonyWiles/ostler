import { describe, expect, it, vi } from 'vitest'
import type { HarnessProjectState, WatchedProject } from '../../src/shared/ostler-api'
import {
  ProjectFolderService,
  describeOpenAgentWork
} from '../../electron/services/project-folder-service'
import { makeWatchedProject } from '../helpers/projects'

const FOLDER = 'C:\\projects\\site'

function makeProject(path: string | null): WatchedProject {
  return makeWatchedProject({ id: 'p1', name: 'Site', path })
}

function harnessState(overrides: Partial<HarnessProjectState> = {}): HarnessProjectState {
  return {
    activeSessions: [],
    reviewSessions: [],
    taskQueue: [],
    ...overrides
  } as unknown as HarnessProjectState
}

function setup(options: { path: string | null; state?: HarnessProjectState }) {
  let project = makeProject(options.path)
  const runtime = { start: vi.fn(), stop: vi.fn() }
  const service = new ProjectFolderService({
    getProject: () => project,
    // The real check (existence, directory, nesting) is ConfigStore's and is
    // tested there; here it only resolves.
    validateProjectFolder: (folderPath) => folderPath.replace(/[\\/]+$/, ''),
    setProjectFolder: (_id, folder) => {
      project = { ...project, path: folder }
      return project
    },
    harness: {
      getState: () => options.state ?? harnessState()
    },
    runtime
  })
  return { service, runtime, current: () => project }
}

describe('ProjectFolderService', () => {
  it('links a folder to a project without one and starts its folder services', () => {
    const { service, runtime, current } = setup({ path: null })
    const linked = service.link('p1', `${FOLDER}\\`)
    expect(linked.path).toBe(FOLDER)
    expect(current().path).toBe(FOLDER)
    expect(runtime.stop).toHaveBeenCalledWith('p1')
    expect(runtime.start).toHaveBeenCalledWith(linked)
  })

  it('refuses to link over a folder that is already linked', () => {
    const { service, runtime } = setup({ path: FOLDER })
    expect(() => service.link('p1', 'C:\\projects\\other')).toThrow(/already has a folder linked/)
    expect(runtime.start).not.toHaveBeenCalled()
  })

  it('links any folder, since agent work lives in the folder itself', () => {
    const { service } = setup({ path: null })
    expect(service.link('p1', 'C:\\projects\\other').path).toBe('C:\\projects\\other')
  })

  it('unlinks a folder and stops its services', () => {
    const { service, runtime, current } = setup({ path: FOLDER })
    const unlinked = service.unlink('p1')
    expect(unlinked.path).toBeNull()
    expect(current().path).toBeNull()
    expect(runtime.stop).toHaveBeenCalledWith('p1')
    expect(runtime.start).not.toHaveBeenCalled()
  })

  it('refuses to unlink while agent work is queued, open or in review', () => {
    const state = harnessState({
      taskQueue: [{ status: 'pending' }, { status: 'claimed' }, { status: 'complete' }],
      activeSessions: [{ id: 's1' }],
      reviewSessions: [{ id: 's2' }]
    } as unknown as Partial<HarnessProjectState>)
    const { service, runtime, current } = setup({ path: FOLDER, state })
    expect(() => service.unlink('p1')).toThrow(
      'Finish the agent work first: 2 agent runs queued, 1 agent run in progress, ' +
        '1 agent run waiting for review. Cancel the queued runs, and stop, accept or discard ' +
        'the others, then unlink the folder.'
    )
    expect(current().path).toBe(FOLDER)
    expect(runtime.stop).not.toHaveBeenCalled()
  })

  it('describes no open work as null', () => {
    expect(describeOpenAgentWork(harnessState())).toBeNull()
  })
})
