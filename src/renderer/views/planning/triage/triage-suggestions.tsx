import { useEffect, useRef, useState } from 'react'
import type { PlanningWorkItem } from '@shared/ostler-api'
import type { TriageSuggestion } from '@shared/triage-suggestions'
import { t } from '@shared/i18n'
import { taskPriorityLabel } from '@shared/task-labels'
import { Button, InlineAlert, useConfirm } from '../../../ui'
import { Sparkles } from '../../../ui/icons'
import { useStatusWords } from '../../../context/ColumnsContext'
import './TriageSuggestions.css'

/** One task's suggestion: asking, answered or failed. */
export interface SuggestionState {
  busy: boolean
  value: TriageSuggestion | null
  error: string | null
}

/**
 * Triage suggestions (N4.3b) for a list of waiting tasks: Suggest on one, or
 * Suggest for all after a confirm that says how many requests it makes, one
 * at a time, each row filling in as its answer arrives. Stop ends the run
 * after the request in flight. Nothing here saves anything.
 */
export function useTriageSuggestions(projectId: string) {
  const confirm = useConfirm()
  const [states, setStates] = useState<Record<string, SuggestionState>>({})
  const [run, setRun] = useState<{ done: number; total: number } | null>(null)
  const stopped = useRef(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      stopped.current = true
    }
  }, [])

  const set = (id: string, state: SuggestionState) =>
    alive.current && setStates((current) => ({ ...current, [id]: state }))

  const suggest = async (item: PlanningWorkItem) => {
    set(item.id, { busy: true, value: null, error: null })
    const result = await window.ostlerAPI.suggestTriage(projectId, item.id)
    if (result.ok) set(item.id, { busy: false, value: result.value, error: null })
    else set(item.id, { busy: false, value: null, error: result.error })
  }

  const suggestAll = async (items: PlanningWorkItem[]) => {
    if (run || items.length === 0) return
    const ok = await confirm({
      title: t('tasks:triageSuggest.confirmTitle', { count: items.length }),
      body: t('tasks:triageSuggest.confirmBody', { count: items.length }),
      confirmLabel: t('tasks:triageSuggest.confirm')
    })
    if (!ok) return
    stopped.current = false
    setRun({ done: 0, total: items.length })
    for (const [index, item] of items.entries()) {
      if (stopped.current) break
      await suggest(item)
      if (alive.current) setRun({ done: index + 1, total: items.length })
    }
    if (alive.current) setRun(null)
  }

  const stop = () => {
    stopped.current = true
  }

  const dismiss = (id: string) =>
    setStates((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })

  return { states, run, suggest, suggestAll, stop, dismiss }
}

/** The Suggest button: hidden by its caller while Ostler AI is off. */
export function SuggestButton({
  item,
  state,
  onSuggest
}: {
  item: PlanningWorkItem
  state: SuggestionState | undefined
  onSuggest: () => void
}) {
  return (
    <Button
      size="sm"
      variant="ai"
      icon={Sparkles}
      loading={state?.busy}
      disabled={state?.busy}
      aria-label={t('tasks:triageSuggest.suggestFor', { title: item.title })}
      title={t('tasks:triageSuggest.suggestHint')}
      onClick={onSuggest}
    >
      {state?.busy ? t('tasks:triageSuggest.suggesting') : t('tasks:triageSuggest.suggest')}
    </Button>
  )
}

/**
 * "Suggested: High · design, website · Looks like 'Fix the header' (In
 * progress)", with Use (when the caller has fields to fill), and for each
 * likely duplicate Duplicate of this and Open. Ignoring it changes nothing.
 */
export function TriageSuggestionLine({
  item,
  state,
  onUse,
  onDuplicate,
  onOpen,
  onDismiss
}: {
  item: PlanningWorkItem
  state: SuggestionState | undefined
  onUse?: (suggestion: TriageSuggestion) => void
  onDuplicate: (originalId: string) => void
  /** Opens a likely duplicate; null when that task cannot be opened here. */
  onOpen: (workItemId: string) => (() => void) | null
  onDismiss: () => void
}) {
  const words = useStatusWords(item.projectId)
  if (!state || state.busy) return null
  if (state.error) {
    return (
      <InlineAlert tone="danger" title={t('tasks:triageSuggest.couldntSuggest')}>
        {state.error}
      </InlineAlert>
    )
  }
  const suggestion = state.value
  if (!suggestion) return null
  const fields = [
    suggestion.priority ? taskPriorityLabel(suggestion.priority) : null,
    suggestion.labels.length > 0 ? suggestion.labels.join(', ') : null
  ].filter((part): part is string => part !== null)
  const empty = fields.length === 0 && suggestion.duplicates.length === 0
  return (
    <div className="triage-suggestion" role="group" aria-label={t('tasks:triageSuggest.suggested')}>
      {empty ? (
        <p className="triage-suggestion__text">{t('tasks:triageSuggest.nothing')}</p>
      ) : (
        <>
          <p className="triage-suggestion__text">
            <span className="triage-suggestion__lead">{t('tasks:triageSuggest.suggested')}</span>{' '}
            {[
              ...fields,
              ...suggestion.duplicates.map((duplicate) =>
                t('tasks:triageSuggest.looksLike', {
                  title: duplicate.title,
                  status: words.label(duplicate.status)
                })
              )
            ].join(' · ')}
          </p>
          {onUse && fields.length > 0 && (
            <div className="triage-suggestion__actions">
              <Button
                size="sm"
                variant="secondary"
                aria-label={t('tasks:triageSuggest.useName', { title: item.title })}
                onClick={() => onUse(suggestion)}
              >
                {t('tasks:triageSuggest.use')}
              </Button>
            </div>
          )}
          {suggestion.duplicates.map((duplicate) => {
            const open = onOpen(duplicate.workItemId)
            return (
              <div key={duplicate.workItemId} className="triage-suggestion__duplicate">
                <span className="triage-suggestion__reason">
                  {duplicate.title}
                  {duplicate.reason ? `: ${duplicate.reason}` : ''}
                </span>
                <span className="triage-suggestion__actions">
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={t('tasks:triageSuggest.duplicateOfThisName', {
                      title: item.title,
                      original: duplicate.title
                    })}
                    onClick={() => onDuplicate(duplicate.workItemId)}
                  >
                    {t('tasks:triageSuggest.duplicateOfThis')}
                  </Button>
                  {open && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('tasks:triageSuggest.openName', { title: duplicate.title })}
                      onClick={open}
                    >
                      {t('tasks:triageSuggest.open')}
                    </Button>
                  )}
                </span>
              </div>
            )
          })}
        </>
      )}
      <div className="triage-suggestion__actions">
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          {t('tasks:triageSuggest.dismiss')}
        </Button>
      </div>
    </div>
  )
}
