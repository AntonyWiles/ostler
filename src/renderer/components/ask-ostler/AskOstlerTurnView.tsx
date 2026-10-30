import Markdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import type { AskSource } from '@shared/ostler-api'
import type { AskConversationTurn } from '@shared/ask-ostler-note'
import { citationNumber, linkCitations } from '@shared/ask-ostler'
import { useOstler } from '../../context/OstlerContext'
import { InlineAlert } from '../../ui'
import { FileCode, Icon } from '../../ui/icons'
import { SEARCH_TYPES } from '../../views/search/search-results'
import { t } from '@shared/i18n'

/** One question of the conversation, with what its answer said about how it was made. */
export interface AskPanelTurn extends AskConversationTurn {
  id: string
  sourcesCut: boolean
  filesCutShort: boolean
  earlierLeftOut: boolean
}

/**
 * One turn of Ask Ostler's conversation (N8.3a, N8.3b): the question, the
 * answer as sanitized Markdown with each [n] a link to this turn's own
 * source, and this turn's numbered source list.
 */
export function AskOstlerTurnView({
  turn,
  onOpenSource
}: {
  turn: AskPanelTurn
  onOpenSource: (source: AskSource) => void
}) {
  const { projects } = useOstler()
  const sourceByNumber = new Map(turn.sources.map((source) => [source.number, source]))
  const projectName = (id: string) => projects.find((project) => project.id === id)?.name ?? ''
  return (
    <section
      className="ask-ostler__answer"
      aria-label={t('ai:askOstler.answerTo', { question: turn.question })}
    >
      <h3 className="ask-ostler__asked">{turn.question}</h3>
      {turn.earlierLeftOut && (
        <p className="ask-ostler__note">{t('ai:askOstler.earlierLeftOut')}</p>
      )}
      <div className="ask-ostler__markdown">
        <Markdown
          rehypePlugins={[rehypeSanitize]}
          components={{
            a: ({ href, children }) => {
              const number = citationNumber(href)
              const source = number === null ? undefined : sourceByNumber.get(number)
              if (!source) return <>{children}</>
              return (
                <button
                  type="button"
                  className="ask-ostler__cite"
                  aria-label={t('ai:askOstler.openSource', {
                    number: source.number,
                    title: source.title
                  })}
                  onClick={() => onOpenSource(source)}
                >
                  {children}
                </button>
              )
            }
          }}
        >
          {linkCitations(turn.answer)}
        </Markdown>
      </div>
      {turn.sourcesCut && <InlineAlert tone="info">{t('ai:askOstler.sourcesCut')}</InlineAlert>}
      {turn.filesCutShort && (
        <InlineAlert tone="info">{t('ai:askOstler.filesCutShort')}</InlineAlert>
      )}
      <h4 className="ask-ostler__heading">{t('ai:askOstler.sources')}</h4>
      {turn.sources.length === 0 ? (
        <p className="ask-ostler__note">{t('ai:askOstler.noSources')}</p>
      ) : (
        <ol className="ask-ostler__sources" aria-label={t('ai:askOstler.sources')}>
          {turn.sources.map((source) => (
            <li key={source.number}>
              <button
                type="button"
                className="ask-ostler__source"
                onClick={() => onOpenSource(source)}
              >
                <span className="ask-ostler__number">{source.number}</span>
                <Icon
                  icon={source.type === 'file' ? FileCode : SEARCH_TYPES[source.type].icon}
                  className="ask-ostler__icon"
                />
                <span className="ask-ostler__title">{sourceTitle(source)}</span>
                <span className="ask-ostler__meta">
                  {source.type === 'file'
                    ? t('ai:askOstler.file')
                    : SEARCH_TYPES[source.type].label}
                  {/* A contact belongs to no project. */}
                  {source.projectId ? ` · ${projectName(source.projectId)}` : null}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function sourceTitle(source: AskSource): string {
  if (source.type === 'file')
    return t('ai:askOstler.fileLines', {
      path: source.path ?? source.id,
      start: source.startLine ?? 1,
      end: source.endLine ?? source.startLine ?? 1
    })
  if (source.type === 'comment') return t('ai:askOstler.commentOn', { title: source.title })
  return source.title
}
