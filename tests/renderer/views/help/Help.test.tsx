// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { HelpView } from '@renderer/views/help/HelpView'
import { GuideMarkdown } from '@renderer/help/GuideMarkdown'
import {
  GUIDE_PAGES,
  buildGuide,
  changelogSection,
  resolveGuideLink,
  splitTitle
} from '@renderer/help/guide'
import { ShortcutOverlay } from '@renderer/components/help/ShortcutOverlay'
import { GettingStartedCard } from '@renderer/views/home/GettingStartedCard'
import {
  SHORTCUTS,
  shortcutGroupLabel,
  shortcutGroups,
  shortcutLabel
} from '@renderer/navigation/shortcuts'
import { IconButton, ToastProvider } from '@renderer/ui'
import { X } from '@renderer/ui/icons'
import { gettingStarted } from '@shared/getting-started'
import { installOstlerApi } from '../../fixtures/ostler-api'

function renderHelp(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="help" element={<HelpView />} />
        <Route path="help/:page" element={<HelpView />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('the user guide (P8.1)', () => {
  it('bundles every page of docs/user-guide, in order, with its title', () => {
    expect(GUIDE_PAGES.length).toBeGreaterThanOrEqual(18)
    expect(GUIDE_PAGES[0].slug).toBe('getting-started')
    expect(GUIDE_PAGES.map((page) => page.slug)).toContain('keyboard-shortcuts')
    for (const page of GUIDE_PAGES) expect(page.title, page.slug).not.toMatch(/^#/)
  })

  it('orders pages by their file number and takes the title from the first heading', () => {
    const pages = buildGuide({
      '/docs/user-guide/02-later.md': '# Later page\n\nText',
      '/docs/user-guide/01-first.md': '# First page\n\nHello',
      '/docs/user-guide/README.md': '# Not a page'
    })
    expect(pages.map((page) => [page.slug, page.title])).toEqual([
      ['first', 'First page'],
      ['later', 'Later page']
    ])
    expect(splitTitle('No heading', 'fallback')).toEqual({ title: 'fallback', body: 'No heading' })
  })

  it('renders a bundled page, and opens the first page from /help', async () => {
    renderHelp('/help')
    expect(
      await screen.findByRole('heading', { level: 2, name: GUIDE_PAGES[0].title })
    ).toBeTruthy()
    const nav = screen.getByRole('navigation', { name: 'User guide pages' })
    expect(within(nav).getAllByRole('link')).toHaveLength(GUIDE_PAGES.length)
  })

  it('renders the shortcuts page with every shortcut', async () => {
    renderHelp('/help/keyboard-shortcuts')
    await screen.findByRole('heading', { level: 2, name: 'Keyboard shortcuts' })
    expect(screen.getByText(/Command palette and search/)).toBeTruthy()
  })

  it('narrows the page list and highlights the words in the open page', async () => {
    renderHelp('/help/keyboard-shortcuts')
    await screen.findByRole('heading', { level: 2, name: 'Keyboard shortcuts' })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the guide' }), {
      target: { value: 'command palette' }
    })
    await waitFor(() => expect(document.querySelectorAll('mark').length).toBeGreaterThan(0))
    expect(document.querySelector('mark')?.textContent?.toLowerCase()).toBe('command palette')
    expect(screen.getByText(/on this page, highlighted/)).toBeTruthy()
  })

  it('sanitises a page: no script runs and javascript: links go nowhere', () => {
    const { container } = render(
      <MemoryRouter>
        <GuideMarkdown>
          {
            'Hello <script>window.hacked = true</script>\n\n[Click me](javascript:alert(1)) and <a href="javascript:alert(2)">raw</a> and <img src=x onerror="window.hacked=true">'
          }
        </GuideMarkdown>
      </MemoryRouter>
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toContain('javascript:')
    expect(container.innerHTML).not.toContain('onerror')
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined()
    expect(container.textContent).toContain('Click me')
    expect(container.querySelector('a')).toBeNull()
  })

  it('opens links to other pages in the guide and web links in the browser', () => {
    expect(resolveGuideLink('03-tasks.md')).toEqual({ kind: 'page', slug: 'tasks', hash: '' })
    expect(resolveGuideLink('https://example.com')).toEqual({
      kind: 'external',
      url: 'https://example.com'
    })
    expect(resolveGuideLink('javascript:alert(1)')).toBeNull()
    expect(resolveGuideLink('file:///C:/secret')).toBeNull()

    const opened: string[] = []
    installOstlerApi({
      openExternalLink: async (url) => {
        opened.push(url)
        return { ok: true, value: undefined }
      }
    })
    render(
      <MemoryRouter>
        <GuideMarkdown>{'[The site](https://example.com) and [Tasks](03-tasks.md)'}</GuideMarkdown>
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('link', { name: 'The site' }))
    expect(opened).toEqual(['https://example.com'])
    expect(screen.getByRole('link', { name: 'Tasks' }).getAttribute('href')).toBe('/help/tasks')
  })
})

describe("What's new (P8.1)", () => {
  const changelog = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '',
    '- Something coming',
    '',
    '## [1.0.0] - 2026-10-01',
    '',
    '### Added',
    '',
    '- The first release',
    ''
  ].join('\n')

  it("shows the running version's section", () => {
    expect(changelogSection(changelog, '1.0.0')).toEqual({
      heading: 'Version 1.0.0',
      body: '### Added\n\n- The first release'
    })
  })

  it('falls back to Unreleased for a version with no section of its own', () => {
    expect(changelogSection(changelog, '1.1.0')?.body).toContain('Something coming')
    expect(changelogSection('# Changelog\n', '1.1.0')).toBeNull()
  })
})

describe('the shortcut overlay (P8.1)', () => {
  it('lists every working shortcut from the table, grouped by where it works', () => {
    render(<ShortcutOverlay open onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    for (const group of shortcutGroups()) {
      expect(
        within(dialog).getByRole('heading', { name: shortcutGroupLabel(group.id) })
      ).toBeTruthy()
    }
    for (const entry of SHORTCUTS) {
      const shown = within(dialog).queryByText(shortcutLabel(entry.id)) !== null
      expect(shown, entry.id).toBe(!('since' in entry))
    }
  })

  it('searches by what a shortcut does or its keys', () => {
    render(<ShortcutOverlay open onClose={() => {}} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search shortcuts' }), {
      target: { value: 'sidebar' }
    })
    expect(screen.getByText('Collapse or expand the sidebar')).toBeTruthy()
    expect(screen.queryByText('Go to Home')).toBeNull()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search shortcuts' }), {
      target: { value: 'nothing like this' }
    })
    expect(screen.getByRole('status').textContent).toContain('No shortcut matches')
  })

  it('shows a shortcut in a tooltip as keycaps from the same table', () => {
    render(<IconButton label="Collapse sidebar" icon={X} shortcut="Ctrl+B" />)
    // Keyboard focus: a tooltip opens on focus that follows a key.
    fireEvent.keyDown(window, { key: 'Tab' })
    fireEvent.focus(screen.getByRole('button', { name: 'Collapse sidebar' }))
    const tooltip = screen.getByRole('tooltip')
    expect(within(tooltip).getByText('Ctrl plus B')).toBeTruthy()
  })
})

describe('the getting-started card (P8.1)', () => {
  const state = (overrides: Partial<Parameters<typeof gettingStarted>[0]> = {}) =>
    gettingStarted({
      createdTask: true,
      datedTask: false,
      aiConfigured: false,
      progress: { dismissed: false, triedView: true, usedSearch: false, sawBackups: false },
      ...overrides
    })

  it('shows what main says is done, and hides when dismissed', async () => {
    let current = state()
    installOstlerApi({
      getGettingStarted: async () => ({ ok: true, value: current }),
      dismissGettingStarted: async () => {
        current = state({
          progress: { dismissed: true, triedView: true, usedSearch: false, sawBackups: false }
        })
        return { ok: true, value: current }
      }
    })
    render(
      <ToastProvider>
        <MemoryRouter>
          <GettingStartedCard />
        </MemoryRouter>
      </ToastProvider>
    )
    expect(await screen.findByRole('heading', { name: 'Getting started' })).toBeTruthy()
    expect(screen.getByText('Create a task').closest('li')?.textContent).toContain(', done')
    expect(screen.getByText('Give a task a due date').closest('li')?.textContent).toContain(
      'not done yet'
    )
    expect(screen.getByRole('link', { name: 'Settings › Data' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hide getting started' }))
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Getting started' })).toBeNull()
    )
  })

  it('is not shown once every step is done', async () => {
    const read = vi.fn()
    installOstlerApi({
      getGettingStarted: async () => (
        read(),
        {
          ok: true,
          value: state({
            datedTask: true,
            progress: { dismissed: false, triedView: true, usedSearch: true, sawBackups: true }
          })
        }
      )
    })
    render(
      <MemoryRouter>
        <GettingStartedCard />
      </MemoryRouter>
    )
    await waitFor(() => expect(read).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: 'Getting started' })).toBeNull()
  })
})

describe("What's new after an update (P8.1)", () => {
  // A version CHANGELOG.md has a section for: one without falls back to Unreleased, which is empty after a release.
  async function renderProvider(lastSeenVersion: string, firstRunCompleted = true) {
    const { HelpProvider } = await import('@renderer/help/HelpProvider')
    const { RENDERER_DEFAULT_CONFIG } = await import('../../fixtures/ostler-api')
    const updates: unknown[] = []
    installOstlerApi({
      getAppVersion: async () => ({ ok: true, value: '0.1.0' }),
      getConfig: async () => ({
        ok: true,
        value: {
          ...RENDERER_DEFAULT_CONFIG,
          ui: { ...RENDERER_DEFAULT_CONFIG.ui, firstRunCompleted, lastSeenVersion }
        }
      }),
      updateConfig: async (update) => {
        updates.push(update)
        return { ok: true, value: RENDERER_DEFAULT_CONFIG }
      }
    })
    render(
      <ToastProvider>
        <MemoryRouter>
          <HelpProvider>
            <p>App</p>
          </HelpProvider>
        </MemoryRouter>
      </ToastProvider>
    )
    return updates
  }

  it('opens once when the version changed, and records it', async () => {
    const updates = await renderProvider('0.0.9')
    expect(await screen.findByRole('dialog', { name: "What's new in Ostler" })).toBeTruthy()
    expect(updates).toEqual([{ ui: { lastSeenVersion: '0.1.0' } }])
  })

  it('stays closed for the version already seen', async () => {
    const seen = await renderProvider('0.1.0')
    await screen.findByText('App')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(seen).toEqual([])
  })
})
