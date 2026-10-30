import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type MutableRefObject
} from 'react'
import type { AskOstlerProgress, AskSource, LibraryItem } from '@shared/ostler-api'
import { useOstler } from '../../context/OstlerContext'
import { Button, Dialog, InlineAlert, Spinner, Switch, TextField } from '../../ui'
import { readSearchFiles, writeSearchFiles } from './ask-ostler-memory'
import { AskOstlerTurnView, type AskPanelTurn } from './AskOstlerTurnView'
import { AskOstlerSaveDialog } from './AskOstlerSaveDialog'
import './AskOstler.css'
import { t } from '@shared/i18n'

/** Asks the panel whether it may close; it calls `proceed` when it may. */
export type AskCloseGuard = (proceed: () => void) => void

interface AskOstlerPanelProps {
  /** The question to start with: what was typed in Search or the palette. */
  initialQuestion: string
  /** Opens a source; the provider navigates and closes the panel. */
  onOpenSource: (source: AskSource) => void
  /** The conversation was saved as this Library note. */
  onSaved: (item: LibraryItem) => void
  /** Set by the panel: the provider closes the panel only through it. */
  closeGuard: MutableRefObject<AskCloseGuard | null>
}

let askCounter = 0
const newAskId = () => `ask-${Date.now().toString(36)}-${(askCounter += 1)}`

/**
 * Ask Ostler's panel (N8.3a, N8.3b): a conversation, newest at the bottom.
 * Each turn is a question, its answer and the answer's own numbered sources;
 * the box under the last answer asks a follow-up, which is sent with the
 * conversation's earlier questions and answers. New question starts again.
 * Nothing is stored unless the conversation is saved as a note.
 */
export function AskOstlerPanel({
  initialQuestion,
  onOpenSource,
  onSaved,
  closeGuard
}: AskOstlerPanelProps) {
  const { projects } = useOstler()
  const [question, setQuestion] = useState(initialQuestion)
  const [searchFiles, setSearchFiles] = useState(readSearchFiles)
  const [turns, setTurns] = useState<AskPanelTurn[]>([])
  const [asking, setAsking] = useState<{ id: string; question: string } | null>(null)
  const [progress, setProgress] = useState<AskOstlerProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stopped, setStopped] = useState(false)
  const [saving, setSaving] = useState(false)
  const [closing, setClosing] = useState<(() => void) | null>(null)
  // The ask whose answer is wanted: a stopped or replaced ask's answer is dropped.
  const current = useRef<string | null>(null)
  const questionField = useRef<HTMLInputElement>(null)

  useEffect(
    () =>
      window.ostlerAPI.onAskOstlerProgress((event) => {
        if (event.askId === current.current) setProgress(event)
      }),
    []
  )
  // Closing the panel mid-ask stops it.
  useEffect(
    () => () => {
      if (current.current) void window.ostlerAPI.cancelAskOstler(current.current)
    },
    []
  )
  // Closing with more than one question asks first: the conversation is not saved.
  // A layout effect, so the guard knows of an answer as soon as it is on the page:
  // a Close clicked before passive effects ran closed without asking.
  useLayoutEffect(() => {
    closeGuard.current = (proceed) => {
      if (turns.length > 1) setClosing(() => proceed)
      else proceed()
    }
  }, [closeGuard, turns.length])
  useEffect(() => () => void (closeGuard.current = null), [closeGuard])

  const ask = (event?: FormEvent) => {
    event?.preventDefault()
    const text = question.trim()
    if (!text || asking) return
    const id = newAskId()
    current.current = id
    setAsking({ id, question: text })
    setProgress(null)
    setError(null)
    setStopped(false)
    const earlier = turns.map((turn) => ({ question: turn.question, answer: turn.answer }))
    void window.ostlerAPI.askOstler(id, text, { searchFiles, earlier }).then((result) => {
      if (current.current !== id) return
      current.current = null
      setAsking(null)
      setProgress(null)
      if (!result.ok) {
        setError(result.error)
        return
      }
      const { answer, sources, sourcesCut, filesCutShort, earlierLeftOut } = result.value
      setTurns((previous) => [
        ...previous,
        { id, question: text, answer, sources, sourcesCut, filesCutShort, earlierLeftOut }
      ])
      setQuestion('')
    })
  }

  const stop = () => {
    if (!asking) return
    void window.ostlerAPI.cancelAskOstler(asking.id)
    current.current = null
    setAsking(null)
    setProgress(null)
    setStopped(true)
  }

  const startAgain = () => {
    if (current.current) void window.ostlerAPI.cancelAskOstler(current.current)
    current.current = null
    setAsking(null)
    setProgress(null)
    setTurns([])
    setQuestion('')
    setError(null)
    setStopped(false)
    questionField.current?.focus()
  }

  const toggleFiles = (value: boolean) => {
    setSearchFiles(value)
    writeSearchFiles(value)
  }

  const progressText = !progress
    ? t('ai:askOstler.stageQueries')
    : progress.stage === 'queries'
      ? t('ai:askOstler.stageQueries')
      : progress.stage === 'searching'
        ? t('ai:askOstler.stageSearching', { count: progress.projectCount })
        : progress.stage === 'files'
          ? t('ai:askOstler.stageFiles', { count: progress.projectCount })
          : t('ai:askOstler.stageWriting')

  const followUp = turns.length > 0

  return (
    <div className="ask-ostler">
      {followUp && (
        <div className="ask-ostler__conversation">
          {turns.map((turn) => (
            <AskOstlerTurnView key={turn.id} turn={turn} onOpenSource={onOpenSource} />
          ))}
        </div>
      )}
      {asking && followUp && <h3 className="ask-ostler__asked">{asking.question}</h3>}
      {asking && (
        <div className="ask-ostler__progress">
          <Spinner size="sm" />
          <span role="status" className="ask-ostler__progress-text">
            {progressText}
          </span>
          <Button variant="secondary" size="sm" onClick={stop}>
            {t('ai:askOstler.stop')}
          </Button>
        </div>
      )}
      {stopped && <p className="ask-ostler__note">{t('ai:askOstler.stopped')}</p>}
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}

      <form className="ask-ostler__form" onSubmit={ask}>
        <TextField
          ref={questionField}
          label={followUp ? t('ai:askOstler.followUp') : t('ai:askOstler.question')}
          placeholder={
            followUp ? t('ai:askOstler.followUpPlaceholder') : t('ai:askOstler.placeholder')
          }
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          className="ask-ostler__question"
          maxLength={2000}
          data-autofocus
        />
        <Button type="submit" variant="ai" disabled={!question.trim() || asking !== null}>
          {t('ai:askOstler.ask')}
        </Button>
      </form>
      <div className="ask-ostler__tools">
        <Switch
          label={t('ai:askOstler.searchFiles')}
          hint={t('ai:askOstler.searchFilesHint')}
          checked={searchFiles}
          disabled={asking !== null}
          onChange={(event) => toggleFiles(event.target.checked)}
        />
        {followUp && (
          <div className="ask-ostler__actions">
            <Button
              variant="secondary"
              size="sm"
              disabled={asking !== null || projects.length === 0}
              onClick={() => setSaving(true)}
            >
              {t('ai:askOstler.saveAsNote')}
            </Button>
            <Button variant="secondary" size="sm" onClick={startAgain}>
              {t('ai:askOstler.newQuestion')}
            </Button>
          </div>
        )}
      </div>

      {closing && (
        <Dialog
          open
          role="alertdialog"
          size="sm"
          title={t('ai:askOstler.closeTitle')}
          onClose={() => setClosing(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setClosing(null)}>
                {t('common:confirm.cancel')}
              </Button>
              <Button
                variant="secondary"
                disabled={projects.length === 0}
                onClick={() => {
                  setClosing(null)
                  setSaving(true)
                }}
              >
                {t('ai:askOstler.saveAsNote')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const proceed = closing
                  setClosing(null)
                  proceed()
                }}
              >
                {t('ai:askOstler.closeAnyway')}
              </Button>
            </>
          }
        >
          <p className="ask-ostler__note">{t('ai:askOstler.closeBody')}</p>
        </Dialog>
      )}
      {saving && (
        <AskOstlerSaveDialog turns={turns} onClose={() => setSaving(false)} onSaved={onSaved} />
      )}
    </div>
  )
}
