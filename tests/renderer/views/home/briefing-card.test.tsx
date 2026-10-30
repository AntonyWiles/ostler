// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Briefing, RendererProject } from '@shared/ostler-api'
import { HomeView } from '@renderer/views/home/HomeView'
import { BriefingCard } from '@renderer/views/home/BriefingCard'
import {
  BRIEFING_AWAY_MS,
  briefingSince,
  openHome,
  readLastLooked,
  writeLastLooked
} from '@renderer/views/home/last-looked'
import { pickVoice } from '@renderer/hooks/useSpeech'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

const project = {
  id: 'web',
  name: 'Website',
  path: null,
  color: '#3b82f6',
  enabled: true,
  customIgnorePatterns: [],
  notes: '',
  tags: [],
  addedAt: 0,
  lastActivity: null,
  hasAutomationToken: false
} as RendererProject

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [project], loading: false })
}))
vi.mock('@renderer/views/planning/PortfolioView', () => ({ PortfolioView: () => null }))

const HOUR = 60 * 60 * 1000

const briefing = (since: number): Briefing => ({
  since,
  until: since + 14 * HOUR,
  projects: [
    {
      projectId: 'web',
      projectName: 'Website',
      projectColor: '#3b82f6',
      finished: [
        {
          actor: 'agent',
          name: null,
          count: 7,
          tasks: [1, 2, 3, 4, 5].map((n) => ({ id: `t${n}`, title: `Task ${n}` }))
        }
      ],
      added: [],
      comments: { count: 0, tasks: [] },
      overdue: { count: 1, tasks: [{ id: 'late', title: 'Pay invoice' }] },
      reminders: { count: 0, tasks: [] },
      runsFinished: { count: 0, tasks: [] },
      runsInReview: { count: 0, tasks: [] },
      questions: 2
    }
  ]
})

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>
}

function renderAt(element: React.ReactNode, ai = false) {
  render(
    <ToastProvider>
      <StaticFeaturesProvider value={{ agents: true, ai }}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  {element}
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </StaticFeaturesProvider>
    </ToastProvider>
  )
}

/** A `speechSynthesis` with no voices yet, as before `voiceschanged`. */
function fakeSpeech() {
  const spoken: { text: string; lang: string }[] = []
  const synth = {
    speak: vi.fn((utterance: { text: string; lang: string }) => spoken.push(utterance)),
    cancel: vi.fn(),
    getVoices: vi.fn(() => [])
  }
  vi.stubGlobal('speechSynthesis', synth)
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      lang = ''
      voice: unknown = null
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(readonly text: string) {}
    }
  )
  return { synth, spoken }
}

describe('Since you were last here: when it shows (N1.6)', () => {
  beforeEach(() => localStorage.clear())

  it('shows after eight hours away, never on a first start, and moves "last looked" when there is no card', () => {
    const now = new Date(2026, 9, 7, 8, 0).getTime()
    expect(briefingSince(null, now)).toBeNull()
    expect(briefingSince(now - BRIEFING_AWAY_MS + 1, now)).toBeNull()
    expect(briefingSince(now - BRIEFING_AWAY_MS, now)).toBe(now - BRIEFING_AWAY_MS)
    expect(briefingSince(now + HOUR, now)).toBeNull()

    expect(openHome(now)).toBeNull()
    expect(readLastLooked()).toBe(now)
    expect(openHome(now + HOUR)).toBeNull()
    expect(readLastLooked()).toBe(now + HOUR)
    // Away for the night: the card shows, and "last looked" waits for Dismiss.
    expect(openHome(now + 12 * HOUR)).toBe(now + HOUR)
    expect(readLastLooked()).toBe(now + HOUR)
  })
})

describe('BriefingCard (N1.6)', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('shows each line with links, five titles then "and 2 more", and Dismiss moves "last looked"', async () => {
    const since = Date.now() - 14 * HOUR
    writeLastLooked(since)
    const getBriefing = vi.fn(async (from: number) => ({
      ok: true as const,
      value: briefing(from)
    }))
    installOstlerApi({
      getBriefing,
      getMyWork: async () => ({
        ok: true,
        value: { today: [], upcoming: [], myDay: [], leftOver: null }
      }),
      getNeedsYou: async () => ({ ok: true, value: [] }),
      getPlanningLabels: async () => ({ ok: true, value: [] })
    })
    renderAt(<HomeView />)
    const card = await screen.findByRole('region', { name: 'Since you were last here' })
    expect(getBriefing).toHaveBeenCalledWith(since)
    const website = await within(card).findByRole('region', { name: 'Website' })
    expect(within(website).getByText('7 tasks finished by agents')).toBeInTheDocument()
    expect(within(website).getByRole('link', { name: 'Task 1' })).toHaveAttribute(
      'href',
      '/projects/web/tasks/t1'
    )
    expect(within(website).getByText('and 2 more')).toBeInTheDocument()
    expect(within(website).getByText('1 due date passed, still open')).toBeInTheDocument()
    expect(within(website).getByText('2 agent questions wait for an answer')).toBeInTheDocument()
    expect(within(website).getByRole('link', { name: 'Open the Inbox' })).toHaveAttribute(
      'href',
      '/inbox'
    )
    // Write it up stays hidden while AI is off.
    expect(within(card).queryByRole('button', { name: 'Write it up' })).toBeNull()

    fireEvent.click(within(card).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('region', { name: 'Since you were last here' })).toBeNull()
    expect(readLastLooked()).toBeGreaterThan(since)
  })

  it('opens on demand from Home’s menu for the last 3 days', async () => {
    const getBriefing = vi.fn(async (from: number) => ({
      ok: true as const,
      value: briefing(from)
    }))
    installOstlerApi({
      getBriefing,
      getMyWork: async () => ({
        ok: true,
        value: { today: [], upcoming: [], myDay: [], leftOver: null }
      }),
      getNeedsYou: async () => ({ ok: true, value: [] }),
      getPlanningLabels: async () => ({ ok: true, value: [] })
    })
    renderAt(<HomeView />)
    expect(screen.queryByRole('region', { name: 'What changed' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Home options' }))
    const before = Date.now()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Show what changed: last 3 days' }))
    const card = await screen.findByRole('region', { name: 'What changed' })
    const asked = getBriefing.mock.calls[0][0]
    expect(before - asked).toBeGreaterThanOrEqual(72 * HOUR - 1000)
    expect(before - asked).toBeLessThanOrEqual(72 * HOUR + 1000)
    fireEvent.click(within(card).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('region', { name: 'What changed' })).toBeNull()
  })

  it('Listen reads the card’s words in order with no voices loaded, and Stop stops it', async () => {
    const { synth, spoken } = fakeSpeech()
    const since = Date.now() - 14 * HOUR
    installOstlerApi({ getBriefing: async () => ({ ok: true, value: briefing(since) }) })
    renderAt(<BriefingCard since={since} away onDismiss={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Listen' }))
    expect(spoken.map((utterance) => utterance.text)).toEqual([
      'Website',
      '7 tasks finished by agents. Task 1. Task 2. Task 3. Task 4. Task 5. and 2 more',
      '1 due date passed, still open. Pay invoice',
      '2 agent questions wait for an answer'
    ])
    expect(spoken[0].lang).toBe('en')
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(synth.cancel).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument()
  })

  it('Write it up shows Ostler AI’s paragraph above the facts when AI is set up', async () => {
    const since = Date.now() - 14 * HOUR
    const writeBriefing = vi.fn(async () => ({
      ok: true as const,
      value: {
        text: 'Agents finished seven tasks on Website.',
        model: 'test-model',
        at: Date.now()
      }
    }))
    installOstlerApi({
      getBriefing: async () => ({ ok: true, value: briefing(since) }),
      writeBriefing
    })
    renderAt(<BriefingCard since={since} away onDismiss={() => {}} />, true)
    fireEvent.click(await screen.findByRole('button', { name: 'Write it up' }))
    expect(await screen.findByText('Agents finished seven tasks on Website.')).toBeInTheDocument()
    expect(writeBriefing).toHaveBeenCalledWith(since, since + 14 * HOUR)
    expect(screen.getByText(/test-model/)).toBeInTheDocument()
    expect(screen.getByText('7 tasks finished by agents')).toBeInTheDocument()
  })

  it('pickVoice prefers the default voice for the language, and copes with none', () => {
    const voice = (lang: string, isDefault = false) =>
      ({ lang, default: isDefault, name: lang }) as SpeechSynthesisVoice
    expect(pickVoice([], 'en')).toBeNull()
    expect(
      pickVoice([voice('de-DE', true), voice('en-GB'), voice('en-US', true)], 'en')?.lang
    ).toBe('en-US')
    expect(pickVoice([voice('de-DE', true), voice('en-GB')], 'en')?.lang).toBe('en-GB')
    expect(pickVoice([voice('de-DE', true)], 'en')).toBeNull()
  })
})
