import { useEffect, useState } from 'react'
import type { PlanningWorkItem, TaskCommit } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Badge, IconButton, useToast } from '../../ui'
import { Copy } from '../../ui/icons'
import { absoluteTimeText, relativeTimeText } from '../../ui/date-text'
import { TaskDrawerSection } from './TaskDrawerSection'
import './TaskCommitsSection.css'

/**
 * The drawer's Commits section (N9.8b): the commits whose messages name the
 * task's ID, newest first, each with its short hash, subject, author and
 * date, "Fixes" in words when the message said so, and Copy hash. Commit
 * messages are untrusted text, shown as plain text. A task no commit names
 * shows no section.
 */
export function TaskCommitsSection({ item }: { item: PlanningWorkItem }) {
  const { toast } = useToast()
  const [commits, setCommits] = useState<TaskCommit[]>([])

  useEffect(() => {
    let live = true
    const load = async () => {
      const result = await window.ostlerAPI.getWorkItemCommits(item.projectId, item.id)
      if (live) setCommits(result.ok ? result.value : [])
    }
    void load()
    // New commits arrive with the project's Git state.
    const unsubscribe = window.ostlerAPI.onProjectStateChange((state) => {
      if (state.projectId === item.projectId && state.field === 'git') void load()
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [item.projectId, item.id])

  if (commits.length === 0) return null

  const copy = async (hash: string) => {
    const copied = await window.ostlerAPI.copyText(hash)
    toast(
      copied.ok
        ? { title: t('tasks:taskId.copied', { text: hash }) }
        : { title: t('tasks:taskId.copyFailed'), body: copied.error, tone: 'danger' }
    )
  }

  return (
    <TaskDrawerSection title={t('tasks:commits.title')} className="task-commits">
      <ul className="task-commits__list" aria-label={t('tasks:commits.list')}>
        {commits.map((commit) => {
          const at = Date.parse(commit.date)
          return (
            <li key={commit.hash} className="task-commits__item">
              <code className="task-commits__hash">{commit.abbreviatedHash}</code>
              <span className="task-commits__text">
                <span className="task-commits__subject">
                  {commit.subject}
                  {commit.fixes && (
                    <>
                      {' '}
                      <Badge tone="success">{t('tasks:commits.fixes')}</Badge>
                    </>
                  )}
                </span>
                <span
                  className="task-commits__meta"
                  title={Number.isNaN(at) ? undefined : absoluteTimeText(at)}
                >
                  {t('tasks:commits.byLine', {
                    author: commit.author,
                    date: Number.isNaN(at) ? commit.date : relativeTimeText(at)
                  })}
                </span>
              </span>
              <IconButton
                label={t('tasks:commits.copyHashOf', { hash: commit.abbreviatedHash })}
                icon={Copy}
                size="sm"
                onClick={() => void copy(commit.hash)}
              />
            </li>
          )
        })}
      </ul>
    </TaskDrawerSection>
  )
}
