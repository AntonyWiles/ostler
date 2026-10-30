import type { GithubLink } from '@shared/ostler-api'
import { respondJson } from '../loopback-http'
import { planningOf } from './common'
import type { AutomationRouteDef } from './route-table'

/**
 * GitHub links on a task (R4.4, D40), through the app's own service: read
 * the cached links, add one (which fetches it), fetch them again, remove
 * one. Only these calls reach GitHub, and only api.github.com. And the
 * commits that name a task.
 */
export const GITHUB_ROUTES: AutomationRouteDef[] = [
  {
    method: 'GET',
    path: '/work-items/:workItemId/github-links',
    description:
      'A task\'s GitHub issues and pull requests, as cached: nothing is fetched. A link is { id, projectId, workItemId, owner, repo, number, kind: "issue" | "pull", url, title, state: "open" | "closed" | "merged" | "draft" | null, fetchedAt (epoch ms or null), createdAt }. title and state are what GitHub said at fetchedAt; null before the first fetch. A task in GET /work-items carries the same list as githubLinks when it has any.',
    response: '{ ok: true, value: GithubLink[] }',
    handler: ({ server, res, project, params }) => {
      if (!server.github)
        return respondJson(res, 503, { ok: false, error: 'GitHub is unavailable' })
      respondJson(res, 200, { ok: true, value: server.github.list(project.id, params.workItemId!) })
    }
  },
  {
    method: 'GET',
    path: '/work-items/:workItemId/commits',
    description:
      'The commits whose messages name this task\'s ID, newest first, from the project\'s Git history as Ostler has read it: { hash, abbreviatedHash, subject, author, date (ISO), fixes }. An ID is the project\'s prefix, a dash or a space, and the number, in any case, as a whole word ("SHOP-12", "shop 12", a branch name such as shop-12-fix-the-login). fixes is true when the ID followed fix, fixes, fixed, close, closes, closed, resolve, resolves or resolved (an optional colon). Links are made as commits arrive and are kept when the prefix changes; nothing here changes the task.',
    response: '{ ok: true, value: TaskCommit[] }',
    handler: ({ server, res, project, params }) =>
      respondJson(res, 200, {
        ok: true,
        value: planningOf(server).commitLinks.listForWorkItem(project.id, params.workItemId!)
      })
  },
  {
    method: 'POST',
    path: '/work-items/:workItemId/github-links',
    description:
      "Link a task to a GitHub issue or pull request, then fetch its title and state from api.github.com (read only: nothing is written to GitHub). reference is a github.com issue or pull request URL, owner/repo#123, or #123 when the project has a GitHub repository (Project settings). github.com only; other hosts are refused. A task links an issue once, and at most 20. The link stays when the fetch fails; problem says why (not found, GitHub's rate limit, a token without access). Ostler's saved GitHub token is used when there is one, and is never returned.",
    request: 'JSON body: { reference: string }',
    response: '{ ok: true, value: { link: GithubLink, problem: string | null } }',
    exampleBody: { reference: 'https://github.com/octo-org/octo-repo/issues/12' },
    handler: async ({ server, res, project, params, path, body }) => {
      if (!server.github)
        return respondJson(res, 503, { ok: false, error: 'GitHub is unavailable' })
      const value = await server.github.add(project.id, params.workItemId!, body.reference)
      server.recordMutation(project, path, 'automation-api add GitHub link')
      respondJson(res, 200, { ok: true, value })
    }
  },
  {
    method: 'POST',
    path: '/work-items/:workItemId/github-links/refresh',
    description:
      "Fetch the task's links again from api.github.com, as Refresh in the app does, and keep their title, state and the time. problems names, by link id, any link that could not be fetched (it keeps its cached title and state). Reaching GitHub's rate limit stops the rest, which get the same message.",
    response: '{ ok: true, value: { links: GithubLink[], problems: { [linkId]: string } } }',
    handler: async ({ server, res, project, params }) => {
      if (!server.github)
        return respondJson(res, 503, { ok: false, error: 'GitHub is unavailable' })
      respondJson(res, 200, {
        ok: true,
        value: await server.github.refresh(project.id, params.workItemId!)
      })
    }
  },
  {
    method: 'DELETE',
    path: '/work-items/:workItemId/github-links/:linkId',
    description: 'Remove a link from a task. Nothing changes on GitHub.',
    response: '{ ok: true, value: GithubLink }',
    handler: ({ server, res, project, params, path }) => {
      if (!server.github)
        return respondJson(res, 503, { ok: false, error: 'GitHub is unavailable' })
      const link: GithubLink | undefined = server.github
        .list(project.id, params.workItemId!)
        .find((entry) => entry.id === params.linkId)
      if (!link) return respondJson(res, 404, { ok: false, error: 'Link not found' })
      const value = server.github.remove(project.id, link.id)
      server.recordMutation(project, path, 'automation-api remove GitHub link')
      respondJson(res, 200, { ok: true, value })
    }
  }
]
