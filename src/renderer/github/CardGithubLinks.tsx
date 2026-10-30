import type { GithubLink } from '@shared/ostler-api'
import { Icon, VisuallyHidden } from '../ui'
import { githubLinkIcon, githubLinkSummary } from './github-link-display'
import './github.css'
import { t } from '@shared/i18n'

/** A card shows at most this many link icons, then a count of the rest. */
const SHOWN = 3

/**
 * A card's GitHub links (R4.4): a small icon per issue or pull request, as
 * last fetched, with its number, kind and state as text for screen readers.
 * A card never fetches; the drawer does, when the task opens.
 */
export function CardGithubLinks({ links }: { links: GithubLink[] }) {
  const own = (link: GithubLink) => githubLinkSummary(link, `${link.owner}/${link.repo}`)
  const shown = links.slice(0, SHOWN)
  const more = links.length - shown.length
  return (
    <span
      className="task-card__github"
      title={links.map((link) => [own(link), link.title].filter(Boolean).join(': ')).join('\n')}
    >
      {shown.map((link) => (
        <Icon
          key={link.id}
          icon={githubLinkIcon(link)}
          className={`is-${link.state ?? 'unknown'}`}
        />
      ))}
      {more > 0 && <span>+{more}</span>}
      <VisuallyHidden>
        {' '}
        {t('tasks:github.cardLinks', { links: links.map(own).join(', ') })}
      </VisuallyHidden>
    </span>
  )
}
