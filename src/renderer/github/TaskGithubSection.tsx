import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { GithubLink, PlanningWorkItem } from '@shared/ostler-api'
import { githubLinkName } from '@shared/github/github-reference'
import { useProjectGithubRepository } from '../context/OstlerContext'
import { Badge, Button, Icon, IconButton, InlineAlert, TextField, useToast } from '../ui'
import { Plus, RefreshCw, Trash2 } from '../ui/icons'
import { absoluteTimeText, relativeTimeText } from '../ui/date-text'
import { TaskDrawerSection } from '../views/planning/TaskDrawerSection'
import {
  githubLinkIcon,
  githubLinkStateText,
  githubLinkStateTone,
  githubLinkSummary
} from './github-link-display'
import './github.css'
import { t } from '@shared/i18n'

/**
 * The drawer's GitHub section (R4.4, D40): the task's issues and pull
 * requests with their title, number, state and when they were fetched. They
 * are fetched when the task opens and when the person presses Refresh, never
 * otherwise. Links are their own records, so they save at once; removing one
 * offers Undo.
 */
export function TaskGithubSection({ item }: { item: PlanningWorkItem }) {
  const { toast, toastUndo } = useToast()
  const repository = useProjectGithubRepository(item.projectId)
  const [links, setLinks] = useState<GithubLink[]>(item.githubLinks ?? [])
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const closed = Boolean(item.deletedAt)

  // The Board read the task again (a link came, went or was fetched elsewhere).
  useEffect(() => setLinks(item.githubLinks ?? []), [item.githubLinks])

  const refresh = async () => {
    setRefreshing(true)
    const result = await window.ostlerAPI.refreshGithubLinks(item.projectId, item.id)
    setRefreshing(false)
    if (!result.ok) return setError(result.error)
    setError(null)
    setLinks(result.value.links)
    setProblems(result.value.problems)
  }

  // Opening the task is the person's action that fetches its links (D40).
  const hasLinks = (item.githubLinks?.length ?? 0) > 0
  useEffect(() => {
    setProblems({})
    setError(null)
    if (hasLinks && !closed) void refresh()
    // Only when another task opens (the section is keyed by task): a refresh is
    // the person's choice after that.
  }, [item.id])

  useEffect(() => {
    if (formOpen) inputRef.current?.focus()
  }, [formOpen])

  const add = async (event: FormEvent) => {
    event.preventDefault()
    if (!reference.trim()) return
    setAdding(true)
    const result = await window.ostlerAPI.addGithubLink(item.projectId, item.id, reference)
    setAdding(false)
    if (!result.ok) return setError(result.error)
    setError(null)
    setReference('')
    setFormOpen(false)
    const { link, problem } = result.value
    setLinks((current) => [...current.filter((entry) => entry.id !== link.id), link])
    setProblems((current) => {
      const next = { ...current }
      if (problem) next[link.id] = problem
      else delete next[link.id]
      return next
    })
  }

  const remove = async (link: GithubLink) => {
    const result = await window.ostlerAPI.removeGithubLink(item.projectId, link.id)
    if (!result.ok) {
      toast({ title: t('tasks:github.couldNotRemove'), body: result.error, tone: 'danger' })
      return
    }
    setLinks((current) => current.filter((entry) => entry.id !== link.id))
    toastUndo(t('tasks:github.removed', { name: githubLinkName(link, repository) }), async () => {
      const restored = await window.ostlerAPI.restoreGithubLink(item.projectId, result.value)
      if (restored.ok) setLinks((current) => [...current, restored.value])
    })
  }

  const collapsible = links.length === 0 && !repository
  return (
    <TaskDrawerSection
      title={t('tasks:github.title')}
      className="task-github"
      collapsible={collapsible}
      defaultOpen={!collapsible}
      // A project with its repository set shows GitHub on every task.
      part={{
        id: 'github',
        inUse: links.length > 0 || !!repository,
        start: closed ? undefined : () => setFormOpen(true)
      }}
      actions={
        <>
          {links.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              icon={RefreshCw}
              loading={refreshing}
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              {t('tasks:github.refresh')}
            </Button>
          )}
          {!closed && !formOpen && (
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setFormOpen(true)}>
              {t('tasks:github.link')}
            </Button>
          )}
        </>
      }
    >
      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}
      {formOpen && (
        <form className="task-github__form" onSubmit={(event) => void add(event)}>
          <TextField
            ref={inputRef}
            label={t('tasks:github.linkLabel')}
            hint={
              repository
                ? t('tasks:github.linkHintRepository', { repository })
                : t('tasks:github.linkHint')
            }
            value={reference}
            maxLength={500}
            onChange={(event) => setReference(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setFormOpen(false)
                setReference('')
              }
            }}
          />
          <div className="task-github__form-actions">
            <Button
              type="submit"
              size="sm"
              variant="primary"
              loading={adding}
              disabled={adding || !reference.trim()}
            >
              {t('tasks:github.add')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={adding}
              onClick={() => {
                setFormOpen(false)
                setReference('')
              }}
            >
              {t('tasks:github.cancel')}
            </Button>
          </div>
        </form>
      )}
      {links.length === 0 && !formOpen && (
        <p className="task-github__empty">{t('tasks:github.none')}</p>
      )}
      {links.length > 0 && (
        <ul className="task-github__links" aria-label={t('tasks:github.links')}>
          {links.map((link) => (
            <li key={link.id} className="task-github__link">
              <Icon
                icon={githubLinkIcon(link)}
                className={`task-github__icon is-${link.state ?? 'unknown'}`}
              />
              <div className="task-github__text">
                <a
                  href={link.url}
                  className="task-github__title"
                  title={link.url}
                  onClick={(event) => {
                    event.preventDefault()
                    void window.ostlerAPI.openExternalLink(link.url)
                  }}
                >
                  <span className="task-github__number">{githubLinkName(link, repository)}</span>{' '}
                  {link.title || t('tasks:github.noTitleYet')}
                </a>
                <span className="task-github__meta">
                  <Badge tone={githubLinkStateTone(link)}>{githubLinkStateText(link)}</Badge>{' '}
                  {link.fetchedAt !== null ? (
                    <time
                      dateTime={new Date(link.fetchedAt).toISOString()}
                      title={absoluteTimeText(link.fetchedAt)}
                    >
                      {t('tasks:github.fetched', { when: relativeTimeText(link.fetchedAt) })}
                    </time>
                  ) : (
                    t('tasks:github.neverFetched')
                  )}
                </span>
                {problems[link.id] && (
                  <span className="task-github__problem">{problems[link.id]}</span>
                )}
              </div>
              {!closed && (
                <IconButton
                  size="sm"
                  icon={Trash2}
                  label={t('tasks:github.remove', { name: githubLinkSummary(link, repository) })}
                  onClick={() => void remove(link)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </TaskDrawerSection>
  )
}
