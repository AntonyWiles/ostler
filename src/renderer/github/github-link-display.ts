import type { GithubLink } from '@shared/ostler-api'
import { githubLinkName } from '@shared/github/github-reference'
import {
  CircleCheck,
  CircleDot,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type LucideIcon
} from '../ui/icons'
import type { BadgeTone } from '../ui'
import { t } from '@shared/i18n'

/**
 * How a GitHub link looks wherever it is shown (R4.4): an icon per kind and
 * state, and words for both, so the state never rests on colour or the icon
 * alone.
 */

export function githubLinkIcon(link: Pick<GithubLink, 'kind' | 'state'>): LucideIcon {
  if (link.kind === 'pull') {
    if (link.state === 'merged') return GitMerge
    if (link.state === 'closed') return GitPullRequestClosed
    if (link.state === 'draft') return GitPullRequestDraft
    return GitPullRequest
  }
  return link.state === 'closed' ? CircleCheck : CircleDot
}

export function githubLinkStateText(link: Pick<GithubLink, 'state'>): string {
  switch (link.state) {
    case 'open':
      return t('tasks:github.stateOpen')
    case 'closed':
      return t('tasks:github.stateClosed')
    case 'merged':
      return t('tasks:github.stateMerged')
    case 'draft':
      return t('tasks:github.stateDraft')
    default:
      return t('tasks:github.stateUnknown')
  }
}

export function githubLinkStateTone(link: Pick<GithubLink, 'state'>): BadgeTone {
  switch (link.state) {
    case 'open':
      return 'success'
    case 'merged':
      return 'accent'
    default:
      return 'neutral'
  }
}

/** "Issue #12, open", for screen readers and tooltips. */
export function githubLinkSummary(link: GithubLink, projectRepository?: string | null): string {
  return t(link.kind === 'pull' ? 'tasks:github.pullSummary' : 'tasks:github.issueSummary', {
    name: githubLinkName(link, projectRepository),
    state: githubLinkStateText(link)
  })
}
