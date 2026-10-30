import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { GUIDE_PAGES, findGuidePage } from '../../help/guide'
import { GuideMarkdown } from '../../help/GuideMarkdown'
import { helpPath } from '../../navigation/paths'
import { EmptyState, SearchField } from '../../ui'
import { BookOpen } from '../../ui/icons'
import './HelpView.css'
import { t } from '@shared/i18n'

/** How many times `query` appears in `text`, ignoring case. */
function countMatches(text: string, query: string): number {
  const needle = query.trim().toLowerCase()
  if (!needle) return 0
  const haystack = text.toLowerCase()
  let count = 0
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    count += 1
  }
  return count
}

/**
 * The user guide at `/help/:page` (P8.1): the bundled pages of
 * `docs/user-guide/`, a page list, and a search that narrows the list to the
 * pages that mention the words and highlights them in the open page. It works
 * offline: nothing is fetched.
 */
export function HelpView() {
  const { page } = useParams<{ page?: string }>()
  const current = findGuidePage(page)
  const [query, setQuery] = useState('')
  const articleRef = useRef<HTMLElement | null>(null)

  const matches = useMemo(
    () =>
      GUIDE_PAGES.map((entry) => ({
        page: entry,
        count: countMatches(`${entry.title}\n${entry.body}`, query)
      })),
    [query]
  )
  const searching = query.trim() !== ''
  const listed = searching ? matches.filter((entry) => entry.count > 0) : matches
  const here = matches.find((entry) => entry.page.slug === current?.slug)?.count ?? 0

  // A new page starts at its top.
  useEffect(() => {
    articleRef.current?.scrollTo?.({ top: 0 })
  }, [current?.slug])

  if (!current) {
    const first = GUIDE_PAGES[0]
    return first ? <Navigate to={helpPath(first.slug)} replace /> : <NoGuide />
  }

  return (
    <div className="ostler-help">
      <nav className="ostler-help-nav" aria-label={t('help:helpView.userGuidePages')}>
        <h1 className="ostler-help-nav-title">{t('help:helpView.userGuide')}</h1>
        <SearchField
          label={t('help:helpView.searchGuide')}
          placeholder={t('help:helpView.searchGuide')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          slashShortcut
        />
        {searching && (
          <p className="ostler-help-nav-status" role="status">
            {listed.length === 0
              ? t('help:helpView.noPageMentions')
              : t('help:helpView.foundPages', { count: listed.length })}
          </p>
        )}
        <ul>
          {listed.map(({ page: entry, count }) => (
            <li key={entry.slug}>
              <Link
                to={helpPath(entry.slug)}
                className="ostler-help-nav-link"
                aria-current={entry.slug === current.slug ? 'page' : undefined}
              >
                <span>{entry.title}</span>
                {searching && (
                  <span
                    className="ostler-help-nav-count"
                    aria-label={t('help:helpView.matches', { count })}
                  >
                    {count}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <article className="ostler-help-page" ref={articleRef} aria-labelledby="ostler-help-title">
        <h2 id="ostler-help-title" className="ostler-help-title">
          {current.title}
        </h2>
        {searching && (
          <p className="ostler-help-page-status" role="status">
            {here === 0
              ? t('help:helpView.notPage')
              : t('help:helpView.matchesPageHighlighted', { count: here })}
          </p>
        )}
        <div className="ostler-help-markdown">
          <GuideMarkdown highlight={query}>{current.body}</GuideMarkdown>
        </div>
      </article>
    </div>
  )
}

function NoGuide() {
  return (
    <EmptyState
      icon={BookOpen}
      title={t('help:helpView.userGuideIsntBuild')}
      description={t('help:helpView.readOnlineRepositoryDocs')}
    />
  )
}
