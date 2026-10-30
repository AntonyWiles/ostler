// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectStateUpdate, ProjectUsage, RendererConfig } from '@shared/ostler-api'
import {
  canPlanAndSplit,
  FeaturesProvider,
  featuresFromConfig,
  ProjectFeaturesProvider,
  StaticFeaturesProvider,
  triageOffered,
  useFeatures,
  viewContext,
  type Features
} from '@renderer/navigation/features'
import { clearProjectTabPrefs, writeTabPrefs } from '@renderer/navigation/tab-prefs'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../fixtures/ostler-api'

function config(agents: boolean, ai: boolean): RendererConfig {
  return {
    ...RENDERER_DEFAULT_CONFIG,
    harness: { ...RENDERER_DEFAULT_CONFIG.harness, enabled: agents },
    ai: { ...RENDERER_DEFAULT_CONFIG.ai, model: 'gpt-4o', hasApiKey: ai }
  }
}

function Probe() {
  const features = useFeatures()
  return <p>{`agents=${features.agents} ai=${features.ai} loaded=${features.loaded}`}</p>
}

describe('useFeatures', () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true]
  ])('reads agents=%s and ai=%s from the config', async (agents, ai) => {
    expect(featuresFromConfig(config(agents, ai))).toEqual({ agents, ai, loaded: true })

    installOstlerApi({ getConfig: async () => ({ ok: true, value: config(agents, ai) }) })
    render(
      <FeaturesProvider>
        <Probe />
      </FeaturesProvider>
    )
    expect(await screen.findByText(`agents=${agents} ai=${ai} loaded=true`)).toBeInTheDocument()
  })

  it('hides nothing for good before the config is read', () => {
    installOstlerApi({ getConfig: () => new Promise(() => {}) })
    render(
      <FeaturesProvider>
        <Probe />
      </FeaturesProvider>
    )
    expect(screen.getByText('agents=false ai=false loaded=false')).toBeInTheDocument()
  })

  it('treats a fresh install as agents off and AI not set up', () => {
    expect(featuresFromConfig(RENDERER_DEFAULT_CONFIG)).toEqual({
      agents: false,
      ai: false,
      loaded: true
    })
  })
})

describe('ProjectFeaturesProvider', () => {
  function ProjectProbe() {
    const features = useFeatures()
    return (
      <p>{`ai=${features.ai} profile=${features.aiProfile} plan=${canPlanAndSplit(features)}`}</p>
    )
  }

  function renderProject(profile: 'software' | 'general', agents = true) {
    installOstlerApi({
      getProjectAISettings: async () => ({
        ok: true,
        value: { projectId: 'p1', profileSetting: 'auto', profile }
      })
    })
    render(
      <StaticFeaturesProvider value={{ agents, ai: true }}>
        <ProjectFeaturesProvider project={{ id: 'p1', path: null, aiProfile: 'auto' }}>
          <ProjectProbe />
        </ProjectFeaturesProvider>
      </StaticFeaturesProvider>
    )
  }

  it('offers Plan and split only for a software project with agents on', async () => {
    renderProject('software')
    expect(await screen.findByText('ai=true profile=software plan=true')).toBeInTheDocument()
  })

  it('keeps Plan and split away from general projects', async () => {
    renderProject('general')
    expect(await screen.findByText(/profile=general plan=false/)).toBeInTheDocument()
  })

  it('keeps Plan and split away while agents are off', async () => {
    renderProject('software', false)
    expect(await screen.findByText(/profile=software plan=false/)).toBeInTheDocument()
  })
})

describe('where To triage is offered', () => {
  const loaded: Features = { agents: false, ai: false, loaded: true }
  const off = { id: 'p1', path: null, triageCaptures: false }

  it('offers it while the setting is on or a task waits, and not otherwise', () => {
    const waiting = new Set(['p2'])
    expect(triageOffered({ ...off, triageCaptures: true }, waiting)).toBe(true)
    expect(triageOffered({ ...off, id: 'p2' }, waiting)).toBe(true)
    expect(triageOffered(off, waiting)).toBe(false)
    // Not known yet: offered, so nothing is hidden by mistake.
    expect(triageOffered(off, undefined)).toBeUndefined()
    expect(triageOffered({ path: null }, waiting)).toBeUndefined()

    expect(viewContext({ ...loaded, triageWaiting: waiting }, off).triage).toBe(false)
    expect(viewContext({ ...loaded, triageWaiting: waiting }, { ...off, id: 'p2' }).triage).toBe(
      true
    )
    expect(viewContext({ ...loaded, triageWaiting: waiting }, null).triage).toBeUndefined()
  })

  it('reads the projects with tasks waiting, and again when tasks change', async () => {
    vi.useFakeTimers()
    try {
      let usage: ProjectUsage = { p1: ['triage', 'decisions'], p2: [] }
      let listener: ((update: ProjectStateUpdate) => void) | null = null
      installOstlerApi({
        getConfig: async () => ({ ok: true, value: config(false, false) }),
        getProjectUsage: async () => ({ ok: true, value: usage }),
        onProjectStateChange: (callback) => {
          listener = callback
          return () => {}
        }
      })
      function WaitingProbe() {
        const features = useFeatures()
        const { triageWaiting } = features
        const uses = viewContext(features, { id: 'p1', path: null }).uses ?? []
        return (
          <>
            <p>{`waiting=${triageWaiting ? [...triageWaiting].join(',') : 'unknown'}`}</p>
            <p>{`p1 uses=${uses.join(',')}`}</p>
          </>
        )
      }
      render(
        <FeaturesProvider>
          <WaitingProbe />
        </FeaturesProvider>
      )
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })
      expect(screen.getByText('waiting=p1')).toBeInTheDocument()
      expect(screen.getByText('p1 uses=triage,decisions')).toBeInTheDocument()

      usage = { p1: ['decisions'], p2: [] }
      await act(async () => {
        listener?.({ projectId: 'p1', field: 'planning' } as ProjectStateUpdate)
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(screen.getByText('waiting=')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('saved tab choices in the view context', () => {
  const loaded: Features = { agents: false, ai: false, loaded: true }

  beforeEach(() => {
    window.localStorage.clear()
  })

  it('gives a project its own saved choice, and the all-projects one otherwise', () => {
    writeTabPrefs('global', { pinned: ['someday'], unpinned: [] })
    writeTabPrefs({ projectId: 'p1' }, { pinned: [], unpinned: ['board'] })

    expect(viewContext(loaded, { id: 'p1', path: null }).tabPrefs).toEqual({
      pinned: [],
      unpinned: ['board']
    })
    expect(viewContext(loaded, { id: 'p2', path: null }).tabPrefs).toEqual({
      pinned: ['someday'],
      unpinned: []
    })

    clearProjectTabPrefs('p1')
    expect(viewContext(loaded, { id: 'p1', path: null }).tabPrefs).toEqual({
      pinned: ['someday'],
      unpinned: []
    })
  })
})
