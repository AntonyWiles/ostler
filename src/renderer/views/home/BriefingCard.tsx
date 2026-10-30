import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Briefing, BriefingWriteUp } from '@shared/ostler-api'
import {
  briefingLines,
  briefingMoreText,
  briefingSpeech,
  type BriefingLine
} from '@shared/briefing-summary'
import { formatDateTime } from '@shared/format'
import { t } from '@shared/i18n'
import { useFeatures } from '../../navigation/features'
import { inboxPath, projectPath } from '../../navigation/paths'
import { useSpeech } from '../../hooks/useSpeech'
import { AiByline } from '../../components/AiByline'
import { Button, Card, InlineAlert, Skeleton } from '../../ui'
import { Sparkles, Square, Volume2, X } from '../../ui/icons'
import './BriefingCard.css'
import { TaskLink } from '../planning/TaskPeek'

/**
 * Since you were last here (N1.6, decision N14): what happened in every
 * project from `since` to now, from Ostler's own records, read after Home's
 * first paint. Listen reads the same words aloud; Write it up adds Ostler
 * AI's paragraph when AI is set up, with the facts still below it.
 */
export function BriefingCard({
  since,
  away,
  onDismiss
}: {
  since: number
  /** Shown because the person was away (Dismiss), not asked for (Close). */
  away: boolean
  onDismiss(): void
}) {
  const features = useFeatures()
  const speech = useSpeech()
  const headingId = useId()
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [writeUp, setWriteUp] = useState<BriefingWriteUp | null>(null)
  const [writing, setWriting] = useState(false)
  const [writeError, setWriteError] = useState<string | null>(null)
  const { stop } = speech

  useEffect(() => {
    let live = true
    setBriefing(null)
    setError(null)
    setWriteUp(null)
    setWriteError(null)
    stop()
    void window.ostlerAPI.getBriefing(since).then((result) => {
      if (!live) return
      if (result.ok) setBriefing(result.value)
      else setError(result.error)
    })
    return () => {
      live = false
    }
  }, [since, stop])

  const write = async () => {
    if (!briefing) return
    setWriting(true)
    setWriteError(null)
    const result = await window.ostlerAPI.writeBriefing(briefing.since, briefing.until)
    setWriting(false)
    if (result.ok) setWriteUp(result.value)
    else setWriteError(result.error)
  }

  const hasNews = briefing !== null && briefing.projects.length > 0

  return (
    <Card as="section" className="ostler-briefing" aria-labelledby={headingId}>
      <header className="ostler-briefing__head">
        <div>
          <h2 id={headingId}>{away ? t('views:briefing.title') : t('views:briefing.titleSpan')}</h2>
          <p className="ostler-briefing__span">
            {t('views:briefing.span', {
              from: formatDateTime(new Date(since), {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                hour: 'numeric',
                minute: '2-digit'
              })
            })}
          </p>
        </div>
        <div className="ostler-briefing__actions">
          {speech.available &&
            briefing !== null &&
            (speech.speaking ? (
              <Button size="sm" icon={Square} onClick={speech.stop}>
                {t('views:briefing.stop')}
              </Button>
            ) : (
              <Button
                size="sm"
                icon={Volume2}
                onClick={() => speech.speak(briefingSpeech(briefing))}
              >
                {t('views:briefing.listen')}
              </Button>
            ))}
          {features.ai && hasNews && (
            <Button
              size="sm"
              variant="ai"
              icon={Sparkles}
              loading={writing}
              onClick={() => void write()}
            >
              {t('views:briefing.writeUp')}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={X} onClick={onDismiss}>
            {away ? t('views:briefing.dismiss') : t('views:briefing.close')}
          </Button>
        </div>
      </header>

      {writeError && (
        <InlineAlert tone="danger" title={t('views:briefing.writeUpFailed')}>
          {writeError}
        </InlineAlert>
      )}
      {writeUp && (
        <div className="ostler-briefing__ai">
          <AiByline model={writeUp.model} at={writeUp.at} />
          <p>{writeUp.text}</p>
        </div>
      )}

      {error ? (
        <InlineAlert tone="danger" title={t('views:briefing.loadFailed')}>
          {error}
        </InlineAlert>
      ) : briefing === null ? (
        <Skeleton lines={3} />
      ) : !hasNews ? (
        <p className="ostler-briefing__quiet">{t('views:briefing.nothingHappened')}</p>
      ) : (
        <div className="ostler-briefing__projects">
          {briefing.projects.map((project) => (
            <section
              key={project.projectId}
              className="ostler-briefing__project"
              aria-label={project.projectName}
            >
              <h3>
                <span
                  className="ostler-briefing__dot"
                  style={{ background: project.projectColor }}
                  aria-hidden="true"
                />
                <Link to={projectPath(project.projectId)}>{project.projectName}</Link>
              </h3>
              <ul>
                {briefingLines(project).map((entry) => (
                  <BriefingLineItem key={entry.key} projectId={project.projectId} line={entry} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  )
}

function BriefingLineItem({ projectId, line }: { projectId: string; line: BriefingLine }) {
  const elsewhere =
    line.link === 'inbox'
      ? { to: inboxPath(), label: t('views:briefing.openInbox') }
      : line.link === 'agents'
        ? { to: projectPath(projectId, 'agents'), label: t('views:briefing.openAgents') }
        : null
  return (
    <li className="ostler-briefing__line">
      <span className="ostler-briefing__text">{line.text}</span>
      {(line.tasks.length > 0 || elsewhere) && (
        <span className="ostler-briefing__tasks">
          {line.tasks.map((task, index) =>
            line.link === 'task' && task.id ? (
              <TaskLink key={`${task.id}-${index}`} projectId={projectId} taskId={task.id}>
                {task.title}
              </TaskLink>
            ) : (
              <span key={`${task.id ?? 'run'}-${index}`}>{task.title}</span>
            )
          )}
          {line.more > 0 && (
            <span className="ostler-briefing__more">{briefingMoreText(line.more)}</span>
          )}
          {elsewhere && <Link to={elsewhere.to}>{elsewhere.label}</Link>}
        </span>
      )}
    </li>
  )
}
