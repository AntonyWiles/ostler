// @vitest-environment jsdom
import { Suspense, lazy, type ReactElement } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AnnouncerProvider } from '@renderer/ui'
import { MAIN_CONTENT_ID, useRouteFocus } from '@renderer/shell/route-focus'
import { SkipLink } from '@renderer/shell/SkipLink'

/** Says which page it is, as the shell does from the registry. */
const LABELS: Record<string, string> = {
  '/home': 'Home',
  '/inbox': 'Inbox',
  '/settings/general': 'Settings',
  '/settings/ai': 'Settings',
  '/search': 'Search'
}

function Shell() {
  const navigate = useNavigate()
  useRouteFocus(LABELS[useLocation().pathname] ?? null)
  return (
    <>
      <SkipLink />
      <nav aria-label="Sidebar">
        <button onClick={() => navigate('/home')}>Home</button>
        <button onClick={() => navigate('/inbox')}>Inbox</button>
        <button onClick={() => navigate('/search')}>Search</button>
      </nav>
      <main id={MAIN_CONTENT_ID} tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<h1>Good morning</h1>} />
          <Route path="/inbox" element={<h1>Inbox</h1>} />
          <Route
            path="/search"
            element={
              <Suspense fallback={<p>Loading</p>}>
                <LazySearch />
              </Suspense>
            }
          />
          <Route path="/settings/:section" element={<Settings />} />
        </Routes>
      </main>
    </>
  )
}

let releaseSearch: () => void = () => {}
const LazySearch = lazy(
  () =>
    new Promise<{ default: () => ReactElement }>((resolve) => {
      releaseSearch = () => resolve({ default: () => <h1>Search</h1> })
    })
)

function Settings() {
  const navigate = useNavigate()
  return (
    <>
      <h1>Settings</h1>
      <nav aria-label="Settings sections">
        <button onClick={() => navigate('/settings/general')}>General</button>
        <button onClick={() => navigate('/settings/ai')}>AI</button>
      </nav>
    </>
  )
}

function renderShell(start = '/home') {
  render(
    <AnnouncerProvider>
      <MemoryRouter initialEntries={[start]}>
        <Shell />
      </MemoryRouter>
    </AnnouncerProvider>
  )
}

const announcement = () => document.querySelector('[data-announcer]')?.textContent?.trim() ?? ''

describe('focus after navigation', () => {
  it('leaves focus alone on the first page, and on `/` redirecting to it', () => {
    renderShell('/')
    expect(document.body).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Good morning' })).not.toHaveFocus()
  })

  it("moves focus to the new page's heading and says the page", () => {
    renderShell()
    const inbox = screen.getByRole('button', { name: 'Inbox' })
    inbox.focus()
    fireEvent.click(inbox)
    expect(screen.getByRole('heading', { name: 'Inbox' })).toHaveFocus()
    expect(announcement()).toMatch(/^Inbox/)
  })

  it('waits for a page that loads its code on first use', async () => {
    renderShell()
    const search = screen.getByRole('button', { name: 'Search' })
    search.focus()
    fireEvent.click(search)
    expect(search).toHaveFocus()
    await act(async () => {
      releaseSearch()
      await Promise.resolve()
    })
    expect(await screen.findByRole('heading', { name: 'Search' })).toHaveFocus()
  })

  it('keeps focus on a control the page still shows, such as section links', () => {
    renderShell('/settings/general')
    const ai = screen.getByRole('button', { name: 'AI' })
    ai.focus()
    fireEvent.click(ai)
    expect(ai).toHaveFocus()
    expect(announcement()).toMatch(/^Settings/)
  })
})

describe('Skip to content', () => {
  it("is the first thing Tab reaches and moves focus to the page's heading", () => {
    renderShell()
    const skip = screen.getByRole('link', { name: 'Skip to content' })
    expect(document.querySelector('a, button')).toBe(skip)
    skip.focus()
    fireEvent.click(skip)
    expect(screen.getByRole('heading', { name: 'Good morning' })).toHaveFocus()
  })
})
