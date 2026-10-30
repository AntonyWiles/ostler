import { useEffect, useRef, useState, type FC } from 'react'
import type { HarnessSession, SessionTranscriptEntry } from '@shared/ostler-api'
import { ProvenanceBadge } from '../../components/ProvenanceBadge'
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  InlineAlert,
  SegmentedControl,
  Select,
  Skeleton
} from '../../ui'
import { ChevronRight, Icon, RefreshCw } from '../../ui/icons'
import { transcriptEntryKind, TRANSCRIPT_KIND_LABEL } from './transcript-entry'
import './LiveTranscriptModal.css'
import { useStickToBottom } from '../../hooks/useStickToBottom'
import { SendGuidanceButton } from './SendGuidance'
import { t } from '@shared/i18n'
import { formatNumber, formatTime } from '@shared/format'

export interface LiveTranscriptModalProps {
  projectId: string
  session: HarnessSession
  onClose: () => void
  /**
   * Every session the reader could switch to. Supplied when the transcript is
   * opened from a surface that watches all running agents (the Planning
   * toolbar), so following a second agent does not mean closing and hunting
   * for it again.
   */
  sessions?: HarnessSession[]
  onSelectSession?: (sessionId: string) => void
}

export const LiveTranscriptModal: FC<LiveTranscriptModalProps> = ({
  projectId,
  session,
  onClose,
  sessions,
  onSelectSession
}) => {
  const [entries, setEntries] = useState<SessionTranscriptEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterRole, setFilterRole] = useState<'all' | 'user' | 'assistant' | 'tool' | 'system'>(
    'all'
  )
  const [liveStreaming, setLiveStreaming] = useState(session.status !== 'done')

  // The checkbox mirrors whether the feed is following: scrolling up unticks
  // it, scrolling back to the bottom re-ticks it, and ticking it jumps there.
  const {
    ref: feedRef,
    onScroll: onFeedScroll,
    stuck: autoScroll,
    setStuck: setAutoScroll,
    scrollToBottom: followFeed
  } = useStickToBottom<HTMLDivElement>(entries)
  // This refetches the whole transcript every 1.5s while an agent is running.
  // Without these, a fetch slower than the interval had the next one stacked on
  // it, and a reply for a session the reader had already switched away from
  // could still overwrite what they were looking at.
  const fetchInFlight = useRef(false)
  const shownSessionId = useRef(session.id)
  shownSessionId.current = session.id

  const fetchTranscript = async () => {
    if (fetchInFlight.current) return
    fetchInFlight.current = true
    const requestedSessionId = session.id
    try {
      const res = await window.ostlerAPI.getHarnessSessionTranscript(projectId, session.id)
      if (requestedSessionId !== shownSessionId.current) return
      if (res.ok) {
        setEntries(res.value)
        setError(null)
      } else {
        setError(res.error)
      }
    } catch (err) {
      if (requestedSessionId !== shownSessionId.current) return
      setError(
        err instanceof Error
          ? err.message
          : t('agents:liveTranscriptModal.couldntLoadTranscriptTry')
      )
    } finally {
      fetchInFlight.current = false
      if (requestedSessionId === shownSessionId.current) setLoading(false)
    }
  }

  useEffect(() => {
    setEntries([])
    setLoading(true)
    setError(null)
    // A different session is a fresh feed; follow it from the start.
    setAutoScroll(true)
    setLiveStreaming(session.status !== 'done')
    void fetchTranscript()
  }, [projectId, session.id])

  useEffect(() => {
    if (!liveStreaming || session.status === 'done') return
    const interval = setInterval(() => {
      void fetchTranscript()
    }, 1500)
    return () => clearInterval(interval)
  }, [projectId, session.id, liveStreaming, session.status])

  const filteredEntries = entries.filter((entry) => {
    if (filterRole === 'all') return true
    return entry.role === filterRole
  })

  const isEmbedded = session.provenance === 'embedded'
  const runtime = session.embeddedRuntime

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      className="transcript"
      title={
        isEmbedded
          ? t('agents:liveTranscriptModal.liveAgentTranscript')
          : t('agents:liveTranscriptModal.agentTranscript')
      }
      description={
        <span className="transcript__heading">
          <ProvenanceBadge
            provenance={session.provenance ?? 'external'}
            embeddedRuntime={runtime}
          />
          {session.status !== 'done' && (
            <Badge tone="success">{t('agents:liveTranscriptModal.live')}</Badge>
          )}
          {!(sessions && sessions.length > 1 && onSelectSession) && <span>{session.title}</span>}
        </span>
      }
      footer={
        <>
          <span className="transcript__count">
            {t('agents:liveTranscriptModal.showingEntries', {
              filteredEntrieCount: filteredEntries.length,
              entrieCount: entries.length
            })}
          </span>
          <SendGuidanceButton projectId={projectId} session={session} size="md" />
          <Button variant="secondary" onClick={onClose}>
            {t('agents:liveTranscriptModal.close')}
          </Button>
        </>
      }
    >
      <div className="transcript__body">
        {sessions && sessions.length > 1 && onSelectSession && (
          <Select
            label={t('agents:liveTranscriptModal.agentRun')}
            size="sm"
            value={session.id}
            onChange={(event) => onSelectSession(event.target.value)}
            options={sessions.map((candidate) => ({
              value: candidate.id,
              label: candidate.blocked
                ? t('agents:agentsTab.sessionWaitingOnYou', { title: candidate.title })
                : candidate.title
            }))}
          />
        )}

        {runtime && (
          <dl className="transcript__stats">
            <div>
              <dt>{t('agents:liveTranscriptModal.port')}</dt>
              <dd>{runtime.processPort}</dd>
            </div>
            <div>
              <dt>{t('agents:liveTranscriptModal.toolCalls')}</dt>
              <dd>{runtime.toolCallCount ?? 0}</dd>
            </div>
            {runtime.maxToolCallsPerMinute && (
              <div>
                <dt>{t('agents:liveTranscriptModal.rate')}</dt>
                <dd>
                  {t('agents:liveTranscriptModal.ratePerMinute', {
                    count: runtime.toolCallsInLastMinute ?? 0,
                    limit: runtime.maxToolCallsPerMinute
                  })}
                </dd>
              </div>
            )}
            <div>
              <dt>{t('agents:liveTranscriptModal.turns')}</dt>
              <dd>{runtime.turnCount ?? 0}</dd>
            </div>
            {runtime.usage?.totalTokens && (
              <div>
                <dt>{t('agents:liveTranscriptModal.tokens')}</dt>
                <dd>{formatNumber(runtime.usage.totalTokens)}</dd>
              </div>
            )}
            {runtime.stoppedForReview && (
              <Badge tone="warning">{t('agents:liveTranscriptModal.stoppedReview')}</Badge>
            )}
          </dl>
        )}

        <div className="transcript__toolbar">
          <SegmentedControl
            label={t('agents:liveTranscriptModal.show')}
            size="sm"
            value={filterRole}
            onChange={setFilterRole}
            options={[
              { value: 'all', label: t('agents:liveTranscriptModal.all') },
              { value: 'user', label: t('agents:liveTranscriptModal.user') },
              { value: 'assistant', label: t('agents:liveTranscriptModal.assistant') },
              { value: 'tool', label: t('agents:liveTranscriptModal.tool') },
              { value: 'system', label: t('agents:liveTranscriptModal.system') }
            ]}
          />
          <span className="transcript__spacer" />
          <Checkbox
            label={t('agents:liveTranscriptModal.autoScroll')}
            checked={autoScroll}
            onChange={(e) => (e.target.checked ? followFeed() : setAutoScroll(false))}
          />
          {session.status !== 'done' && (
            <Checkbox
              label={t('agents:liveTranscriptModal.liveStream')}
              checked={liveStreaming}
              onChange={(e) => setLiveStreaming(e.target.checked)}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={RefreshCw}
            title={t('agents:liveTranscriptModal.refreshTranscript')}
            onClick={() => void fetchTranscript()}
          >
            {t('agents:liveTranscriptModal.refresh')}
          </Button>
        </div>

        {error && <InlineAlert tone="danger">{error}</InlineAlert>}

        <div
          ref={feedRef}
          onScroll={onFeedScroll}
          className="transcript__feed"
          role="log"
          aria-label={t('agents:liveTranscriptModal.transcript')}
        >
          {loading && entries.length === 0 ? (
            <Skeleton lines={4} />
          ) : filteredEntries.length === 0 ? (
            <p className="transcript__empty">
              {t('agents:liveTranscriptModal.noTranscriptActivityRecorded')}
            </p>
          ) : (
            filteredEntries.map((entry, index) => (
              <TranscriptEntry key={`${entry.timestamp}-${index}`} entry={entry} />
            ))
          )}
        </div>
      </div>
    </Dialog>
  )
}

/**
 * One message as a bubble. A tool call or its result is collapsed to its first
 * line: the feed reads as conversation, with the commands one click away.
 */
const NEWLINE = '\n'

function TranscriptEntry({ entry }: { entry: SessionTranscriptEntry }) {
  const kind = transcriptEntryKind(entry)
  const time = formatTime(new Date(entry.timestamp), { timeStyle: 'medium' })
  if (kind === 'tool-call' || kind === 'tool-result') {
    const [firstLine, ...rest] = entry.content.split(NEWLINE)
    const body = (
      <>
        <span className="transcript__label">{TRANSCRIPT_KIND_LABEL[kind]}</span>
        <code className="transcript__tool-line">{firstLine}</code>
        <time className="transcript__time">{time}</time>
      </>
    )
    return rest.length === 0 ? (
      <div className="transcript__entry" data-kind={kind}>
        <div className="transcript__tool-summary">{body}</div>
      </div>
    ) : (
      <details className="transcript__entry" data-kind={kind}>
        <summary className="transcript__tool-summary">
          <Icon icon={ChevronRight} className="transcript__chevron" />
          {body}
        </summary>
        <pre className="transcript__text">{rest.join(NEWLINE)}</pre>
      </details>
    )
  }
  return (
    <div className="transcript__entry" data-kind={kind}>
      <div className="transcript__meta">
        <span className="transcript__label">{TRANSCRIPT_KIND_LABEL[kind]}</span>
        <time className="transcript__time">{time}</time>
      </div>
      <pre className="transcript__text">{entry.content}</pre>
    </div>
  )
}
