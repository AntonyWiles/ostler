import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { SearchEntityType, SearchResult } from '@shared/ostler-api'
import { SEARCH_ENTITY_TYPES } from '@shared/ostler-api'
import { useOstler } from '../../context/OstlerContext'
import {
  Button,
  EmptyState,
  InlineAlert,
  PageHeader,
  SearchField,
  Select,
  Skeleton
} from '../../ui'
import { Icon, Search, Sparkles } from '../../ui/icons'
import { useAskOstler } from '../../components/ask-ostler/AskOstlerProvider'
import {
  SEARCH_TYPES,
  Snippet,
  locationLabel,
  searchResultPath,
  snippetText
} from './search-results'
import './SearchView.css'
import { PERF_MARKS } from '@shared/perf-marks'
import { markPerf, useRenderedMark } from '../../lib/perf-marks'
import { joinSentences, t } from '@shared/i18n'
import { taskIdLabel } from '@shared/task-key'
import { projectSelectOptions } from '../../components/areas/project-options'
import { ProjectMark } from '../../components/ProjectMark'

/** How long typing settles before searching. */
const SEARCH_DELAY_MS = 150

/**
 * Full search results (P5.7, `/search?q=`): every task, comment, decision,
 * milestone, goal and Library item whose words match, best first, with the
 * matching words marked. Filters by type and project. From the search box,
 * Down and Up move through the results and Enter opens one in place; the
 * address keeps the words, type and project, so Back returns here.
 */
export function SearchView() {
  const navigate = useNavigate()
  const { projects, areas } = useOstler()
  const askOstler = useAskOstler()
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const typeParam = params.get('type')
  const type = SEARCH_ENTITY_TYPES.includes(typeParam as SearchEntityType)
    ? (typeParam as SearchEntityType)
    : null
  const projectParam = params.get('project')
  const projectId = projects.some((project) => project.id === projectParam) ? projectParam : null

  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const [shownFor, setShownFor] = useState('')
  useRenderedMark(PERF_MARKS.searchResultsShown, shownFor !== '', shownFor)
  const listId = useId()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setError(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      markPerf(PERF_MARKS.searchStarted, { key: query })
      void window.ostlerAPI
        .search(query, {
          projectId: projectId ?? undefined,
          types: type ? [type] : undefined,
          limit: 100
        })
        .then((result) => {
          if (cancelled) return
          if (result.ok) {
            setResults(result.value)
            setError(null)
          } else {
            setResults([])
            setError(result.error)
          }
          setActiveIndex(0)
          setShownFor(query)
        })
    }, SEARCH_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, type, projectId])

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const open = (result: SearchResult) => navigate(searchResultPath(result))
  const list = results ?? []
  const projectOf = (id: string) => projects.find((project) => project.id === id)
  const optionId = (index: number) => `${listId}-result-${index}`

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (list.length ? (index + 1) % list.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (list.length ? (index - 1 + list.length) % list.length : 0))
    } else if (event.key === 'Enter' && list[activeIndex]) {
      event.preventDefault()
      open(list[activeIndex])
    }
  }

  useEffect(() => {
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' })
    // optionId is stable for the list.
  }, [activeIndex])

  return (
    <div className="ostler-search">
      <PageHeader
        title={t('views:searchView.search')}
        subtitle={
          query.trim() && results
            ? list.length === 100
              ? t('views:searchView.firstHundredResults')
              : t('views:searchView.resultCount', { count: list.length })
            : t('views:searchView.tasksCommentsDecisionsMilestones')
        }
      />
      <div className="ostler-search__content">
        <div className="ostler-search__controls">
          <SearchField
            ref={inputRef}
            label={t('views:searchView.search2')}
            placeholder={t('views:searchView.searchEverything')}
            className="ostler-search__field"
            value={query}
            role="combobox"
            aria-expanded={list.length > 0}
            aria-controls={listId}
            aria-activedescendant={list[activeIndex] ? optionId(activeIndex) : undefined}
            onChange={(event) => setParam('q', event.target.value)}
            onClear={() => setParam('q', null)}
            onKeyDown={onKeyDown}
          />
          {askOstler.available && (
            <Button variant="ai" size="sm" icon={Sparkles} onClick={() => askOstler.open(query)}>
              {t('ai:askOstler.searchButton')}
            </Button>
          )}
          <Select
            label={t('views:searchView.type')}
            hideLabel
            size="sm"
            value={type ?? ''}
            onChange={(event) => setParam('type', event.target.value || null)}
            options={[
              { value: '', label: t('views:searchView.everything') },
              ...SEARCH_ENTITY_TYPES.map((entry) => ({
                value: entry,
                label: SEARCH_TYPES[entry].group
              }))
            ]}
          />
          <Select
            label={t('views:searchView.project')}
            hideLabel
            size="sm"
            value={projectId ?? ''}
            onChange={(event) => setParam('project', event.target.value || null)}
            options={[
              { value: '', label: t('views:searchView.allProjects') },
              ...projectSelectOptions(projects, areas)
            ]}
          />
        </div>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        {!query.trim() ? (
          <EmptyState
            icon={Search}
            title={t('views:searchView.searchProjects')}
            description={t('views:searchView.typeWordTaskComment')}
          />
        ) : results === null ? (
          <Skeleton lines={4} />
        ) : list.length === 0 && !error ? (
          <EmptyState
            icon={Search}
            title={t('views:searchView.noResults')}
            description={t('views:searchView.nothingMatchesEveryWord')}
          />
        ) : (
          <ul
            id={listId}
            className="ostler-search__results"
            role="listbox"
            aria-label={t('views:searchView.results')}
          >
            {list.map((result, index) => {
              const kind = SEARCH_TYPES[result.type]
              const project = projectOf(result.projectId)
              const excerpt = snippetText(result.snippet)
              const place = locationLabel(result.location)
              return (
                <li
                  key={`${result.type}:${result.id}`}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                  aria-label={joinSentences([
                    t('views:searchView.resultName', { kind: kind.label, title: result.title }),
                    result.key && taskIdLabel(result.key),
                    result.inTriage && t('tasks:triage.badge'),
                    excerpt,
                    place,
                    project?.name
                  ])}
                  className={`ostler-search__result${index === activeIndex ? ' is-active' : ''}`}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => open(result)}
                >
                  <Icon icon={kind.icon} className="ostler-search__icon" />
                  <span className="ostler-search__text">
                    <span className="ostler-search__title">
                      {result.type === 'comment'
                        ? t('views:searchView.comment', { resultTitle: result.title })
                        : result.title}
                    </span>
                    {result.snippet.length > 0 && (
                      <span className="ostler-search__snippet">
                        <Snippet parts={result.snippet} />
                      </span>
                    )}
                  </span>
                  <span className="ostler-search__meta">
                    {place && <span>{place}</span>}
                    {result.key && (
                      <span className="ostler-search__key">{taskIdLabel(result.key)}</span>
                    )}
                    {result.inTriage && <span>{t('tasks:triage.badge')}</span>}
                    <span>{kind.label}</span>
                    {project && (
                      <span className="ostler-search__project">
                        <ProjectMark project={project} className="ostler-search__dot" />
                        {project.name}
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
