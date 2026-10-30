import type { GithubIssueQuery, GithubLink, WatchedProject } from '@shared/ostler-api'
import { toRendererConfig } from '@shared/renderer-config'
import { formatGithubRepository, parseGithubRepository } from '@shared/github/github-reference'
import { projectFolder } from '@shared/project-folder'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import type { ConfigStore } from '../config-store'
import type { GithubLinkService } from '../services/github/github-link-service'
import type { GitReaderService } from '../services/git-reader'
import type { ImportService } from '../services/import-service'
import { handleApi } from './handle-ipc'

export interface GithubHandlerDependencies {
  configStore: ConfigStore
  githubLinks: GithubLinkService
  importService: ImportService
  gitReader: GitReaderService
  getProject(projectId: string): WatchedProject
}

/** The longest token Ostler keeps; GitHub's are far shorter. */
const MAX_TOKEN_LENGTH = 512

/**
 * GitHub (R4.4, D40): links on tasks, the repository suggestion, the issues
 * an import reads, and the token. Every request to GitHub here answers a
 * person's action in the window. The token arrives once and never goes back:
 * the renderer sees `github.hasToken`.
 */
export function registerGithubHandlers(deps: GithubHandlerDependencies): void {
  const { configStore, githubLinks, importService, getProject } = deps

  handleApi('refreshGithubLinks', (_event, projectId: string, workItemId: string) =>
    githubLinks.refresh(getProject(projectId).id, workItemId)
  )
  handleApi('addGithubLink', (_event, projectId: string, workItemId: string, reference: string) =>
    githubLinks.add(getProject(projectId).id, workItemId, reference)
  )
  handleApi('removeGithubLink', (_event, projectId: string, linkId: string) =>
    githubLinks.remove(getProject(projectId).id, linkId)
  )
  handleApi('restoreGithubLink', (_event, projectId: string, link: GithubLink) =>
    githubLinks.restore(getProject(projectId).id, link)
  )
  // Read-only Git: the origin remote's URL, offered for the person to confirm.
  handleApi('suggestGithubRepository', async (_event, projectId: string) => {
    const project = getProject(projectId)
    const url = await deps.gitReader.getOriginUrl(projectFolder(project))
    const repository = url ? parseGithubRepository(url) : null
    return repository ? formatGithubRepository(repository) : null
  })

  handleApi('loadGithubIssues', (_event, query: GithubIssueQuery) =>
    importService.loadGithubIssues(query)
  )
  handleApi('previewGithubImport', (_event, fileId: string, projectId: string | null) =>
    importService.previewGithub(fileId, projectId ? getProject(projectId).id : null)
  )

  handleApi('setGithubToken', (_event, token: unknown) => {
    const value = typeof token === 'string' ? token.trim() : ''
    if (!value || value.length > MAX_TOKEN_LENGTH || /\s/.test(value))
      throw new Refusal(t('errors:github.tokenInvalid'))
    return toRendererConfig(configStore.update({ github: { token: value } }))
  })
  handleApi('clearGithubToken', () =>
    toRendererConfig(configStore.update({ github: { token: '' } }))
  )
}
