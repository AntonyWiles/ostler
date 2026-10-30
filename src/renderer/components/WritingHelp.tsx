import { useState, type ReactNode, type RefObject } from 'react'
import {
  diffWords,
  WRITING_HELP_MAX_CHARS,
  WRITING_STYLES,
  replaceRange,
  type ImprovedWriting,
  type WritingStyle,
  type WritingTarget
} from '@shared/writing-help'
import { useFeatures } from '../navigation/features'
import { Button, InlineAlert, Menu, VisuallyHidden } from '../ui'
import { Sparkles } from '../ui/icons'
import { t } from '@shared/i18n'
import './WritingHelp.css'

interface Pending {
  result: ImprovedWriting
  /** The range of the editor's text the suggestion replaces. */
  start: number
  end: number
  /** Whether that range is a selection rather than the whole text. */
  selection: boolean
}

export interface WritingHelpOptions {
  projectId: string
  target: WritingTarget
  /** The text as it is in the editor now, saved or not. */
  value: string
  /** Sets the editor's text, as typing would; used when the text box is not on screen. */
  onChange: (next: string) => void
  /** The text box, for its selection and so Accept types into it (keeping its undo). */
  textRef: RefObject<HTMLTextAreaElement | null>
  /** Names the text box on the button when a form has several. */
  fieldLabel?: string
  /** True for a Library item set to Human only. */
  hidden?: boolean
}

export interface WritingHelp {
  /** The Improve writing button, or null when it is hidden. */
  button: ReactNode
  /** The suggestion, or null when there is none. */
  suggestion: ReactNode
}

/**
 * Improve writing (N8.2), shared by the Library editor, a task's description
 * and a decision's text fields. The button asks Ostler AI for one style; the
 * suggestion shows the words added and removed, and changes nothing until
 * Accept types it into the text box, so the editor's saving and undo apply.
 */
export function useWritingHelp({
  projectId,
  target,
  value,
  onChange,
  textRef,
  fieldLabel,
  hidden = false
}: WritingHelpOptions): WritingHelp {
  const features = useFeatures()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)

  const ask = async (style: WritingStyle, range?: { start: number; end: number }) => {
    const node = textRef.current
    let start = range?.start ?? 0
    let end = range?.end ?? value.length
    if (!range && node && node.selectionEnd > node.selectionStart) {
      start = node.selectionStart
      end = node.selectionEnd
    }
    const selection = start > 0 || end < value.length
    const text = value.slice(start, end)
    setError(null)
    if (text.length > WRITING_HELP_MAX_CHARS) {
      setError(t('ai:writingHelp.tooLong', { max: WRITING_HELP_MAX_CHARS }))
      return
    }
    setBusy(true)
    try {
      const result = await window.ostlerAPI.improveWriting(projectId, { target, style, text })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setPending({ result: result.value, start, end, selection })
    } finally {
      setBusy(false)
    }
  }

  const accept = () => {
    if (!pending) return
    const { result, start, end } = pending
    if (value.slice(start, end) !== result.original) {
      setError(t('ai:writingHelp.textChanged'))
      return
    }
    const node = textRef.current
    let typed = false
    if (node && node.isConnected) {
      node.focus()
      node.setSelectionRange(start, end)
      // Typing through the browser keeps the text box's own undo (Ctrl+Z).
      typed = document.execCommand?.('insertText', false, result.suggestion) ?? false
    }
    if (!typed) onChange(replaceRange(value, start, end, result.suggestion))
    setPending(null)
    setError(null)
  }

  if (hidden || !features.ai) return { button: null, suggestion: null }

  const label = fieldLabel
    ? t('ai:writingHelp.improveField', { field: fieldLabel })
    : t('ai:writingHelp.improve')
  const button = (
    <Menu
      label={label}
      renderTrigger={(trigger) => (
        <Button
          {...trigger}
          size="sm"
          variant="ai"
          icon={Sparkles}
          loading={busy}
          aria-label={label}
          disabled={busy || !value.trim()}
        >
          {busy ? t('ai:writingHelp.improving') : t('ai:writingHelp.improve')}
        </Button>
      )}
      items={WRITING_STYLES.map((style) => ({
        label: t(`ai:writingHelp.styles.${style}`),
        onSelect: () => void ask(style)
      }))}
    />
  )

  const suggestion =
    pending || error ? (
      <section
        className="writing-help__suggestion"
        aria-label={
          pending
            ? t('ai:writingHelp.suggestion', {
                style: t(`ai:writingHelp.styles.${pending.result.style}`)
              })
            : label
        }
      >
        {error && (
          <InlineAlert tone="danger" onDismiss={() => setError(null)}>
            {error}
          </InlineAlert>
        )}
        {pending && (
          <>
            <h4 className="writing-help__title">
              {t('ai:writingHelp.suggestion', {
                style: t(`ai:writingHelp.styles.${pending.result.style}`)
              })}
            </h4>
            {pending.selection && (
              <p className="writing-help__muted">{t('ai:writingHelp.selectionOnly')}</p>
            )}
            {pending.result.missingLinks.length > 0 && (
              <InlineAlert tone="warning">
                {t('ai:writingHelp.linksMissing', {
                  count: pending.result.missingLinks.length,
                  links: pending.result.missingLinks.join(', ')
                })}
              </InlineAlert>
            )}
            {pending.result.suggestion === pending.result.original ? (
              <p className="writing-help__muted">{t('ai:writingHelp.noChange')}</p>
            ) : (
              <SuggestionDiff before={pending.result.original} after={pending.result.suggestion} />
            )}
            <div className="writing-help__actions">
              <Button size="sm" variant="primary" onClick={accept}>
                {t('ai:writingHelp.accept')}
              </Button>
              <Button
                size="sm"
                loading={busy}
                onClick={() =>
                  void ask(pending.result.style, { start: pending.start, end: pending.end })
                }
              >
                {t('ai:writingHelp.tryAgain')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPending(null)
                  setError(null)
                }}
              >
                {t('ai:writingHelp.discard')}
              </Button>
            </div>
          </>
        )}
      </section>
    ) : null

  return { button, suggestion }
}

/** The suggestion with its words marked added and removed, also in words for screen readers. */
export function SuggestionDiff({ before, after }: { before: string; after: string }) {
  return (
    <p className="writing-help__diff">
      {diffWords(before, after).map((part, index) =>
        part.kind === 'same' ? (
          <span key={index}>{part.text}</span>
        ) : part.kind === 'added' ? (
          <ins key={index} className="writing-help__added">
            <VisuallyHidden>{t('ai:writingHelp.added')} </VisuallyHidden>
            {part.text}
          </ins>
        ) : (
          <del key={index} className="writing-help__removed">
            <VisuallyHidden>{t('ai:writingHelp.removed')} </VisuallyHidden>
            {part.text}
          </del>
        )
      )}
    </p>
  )
}

/** The text box with its suggestion beside it, or below it in a narrow window. */
export function WritingHelpLayout({
  suggestion,
  children,
  className
}: {
  suggestion: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`writing-help${suggestion ? ' writing-help--open' : ''}${className ? ` ${className}` : ''}`}
    >
      <div className="writing-help__text">{children}</div>
      {suggestion}
    </div>
  )
}
