// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GithubLink, OstlerAPI, PlanningWorkItem } from '@shared/ostler-api'
import { ToastProvider } from '@renderer/ui'
import { TaskGithubSection } from '@renderer/github/TaskGithubSection'
import { CardGithubLinks } from '@renderer/github/CardGithubLinks'
import { installOstlerApi } from '../../fixtures/ostler-api'

function link(partial: Partial<GithubLink> = {}): GithubLink {
  return {
    id: 'l1',
    projectId: 'p1',
    workItemId: 't1',
    owner: 'acme',
    repo: 'site',
    number: 12,
    kind: 'issue',
    url: 'https://github.com/acme/site/issues/12',
    title: 'Footer links are broken',
    state: 'open',
    fetchedAt: Date.now() - 60_000,
    createdAt: 1,
    ...partial
  }
}

const task = (links?: GithubLink[]) =>
  ({
    id: 't1',
    projectId: 'p1',
    title: 'Fix footer',
    archivedAt: null,
    deletedAt: null,
    ...(links ? { githubLinks: links } : {})
  }) as unknown as PlanningWorkItem

function renderSection(item: PlanningWorkItem) {
  return render(
    <ToastProvider>
      <TaskGithubSection item={item} />
    </ToastProvider>
  )
}

describe("the drawer's GitHub section (R4.4)", () => {
  afterEach(() => vi.restoreAllMocks())

  it('asks GitHub nothing for a task without links', async () => {
    const refreshGithubLinks = vi.fn<OstlerAPI['refreshGithubLinks']>()
    installOstlerApi({ refreshGithubLinks })
    renderSection(task())
    // No repository and no links: the section starts closed.
    fireEvent.click(screen.getByRole('button', { name: 'GitHub' }))
    expect(await screen.findByText('No issues or pull requests linked.')).toBeTruthy()
    expect(refreshGithubLinks).not.toHaveBeenCalled()
  })

  it('fetches the links when the task opens and on Refresh, and shows their state', async () => {
    const refreshGithubLinks = vi.fn<OstlerAPI['refreshGithubLinks']>(async () => ({
      ok: true,
      value: {
        links: [link({ state: 'closed', title: 'Footer links fixed' })],
        problems: {}
      }
    }))
    installOstlerApi({ refreshGithubLinks })
    renderSection(task([link()]))
    expect(await screen.findByText('Footer links fixed')).toBeTruthy()
    expect(refreshGithubLinks).toHaveBeenCalledTimes(1)
    const list = screen.getByRole('list', { name: 'Linked issues and pull requests' })
    expect(within(list).getByText('Closed')).toBeTruthy()
    expect(within(list).getByText(/^fetched /)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(refreshGithubLinks).toHaveBeenCalledTimes(2))
  })

  it("shows why a link couldn't be fetched, keeping what it had", async () => {
    installOstlerApi({
      refreshGithubLinks: async () => ({
        ok: true,
        value: { links: [link()], problems: { l1: "GitHub's limit is reached." } }
      })
    })
    renderSection(task([link()]))
    expect(await screen.findByText("GitHub's limit is reached.")).toBeTruthy()
    expect(screen.getByText('Footer links are broken')).toBeTruthy()
  })

  it('links an issue the person typed, and removes it with Undo', async () => {
    const added = link({ id: 'l2', number: 30, title: '', state: null, fetchedAt: null })
    const addGithubLink = vi.fn<OstlerAPI['addGithubLink']>(async () => ({
      ok: true,
      value: { link: added, problem: 'GitHub can’t find this.' }
    }))
    const removeGithubLink = vi.fn<OstlerAPI['removeGithubLink']>(async () => ({
      ok: true,
      value: added
    }))
    const restoreGithubLink = vi.fn<OstlerAPI['restoreGithubLink']>(async () => ({
      ok: true,
      value: added
    }))
    installOstlerApi({ addGithubLink, removeGithubLink, restoreGithubLink })
    renderSection(task())
    fireEvent.click(screen.getByRole('button', { name: 'GitHub' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Link an issue or pull request' }))
    fireEvent.change(screen.getByLabelText('Issue or pull request'), {
      target: { value: 'acme/site#30' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    expect(await screen.findByText('GitHub can’t find this.')).toBeTruthy()
    expect(addGithubLink).toHaveBeenCalledWith('p1', 't1', 'acme/site#30')
    expect(screen.getByText('not fetched yet')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Issue acme/site#30, Not fetched' }))
    await waitFor(() => expect(removeGithubLink).toHaveBeenCalledWith('p1', 'l2'))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(restoreGithubLink).toHaveBeenCalledWith('p1', added))
  })
})

describe("a card's GitHub links (R4.4)", () => {
  it('shows an icon per link with its state as text', () => {
    render(
      <CardGithubLinks
        links={[
          link(),
          link({ id: 'l2', number: 20, kind: 'pull', state: 'merged', title: 'Fix it' })
        ]}
      />
    )
    expect(
      screen.getByText('GitHub: Issue #12, Open, Pull request #20, Merged', { exact: false })
    ).toBeTruthy()
  })
})
