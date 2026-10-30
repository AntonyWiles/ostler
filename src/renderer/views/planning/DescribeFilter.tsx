import { useRef, useState, type FormEvent } from 'react'
import { todayIsoDate } from '@shared/dates'
import { FILTER_WORDS_MAX_TEXT, type FilterWordsNote } from '@shared/filter-from-words'
import { fieldSpec, type TaskFilter } from '@shared/task-filter'
import { t } from '@shared/i18n'
import { useFeatures } from '../../navigation/features'
import { Button, InlineAlert, Popover, TextField, useToast } from '../../ui'
import { Sparkles } from '../../ui/icons'
import { localeWeekStart } from '../../ui/calendar-layout'

/** A note about the answer, in words: "Could not find a label called 'urgent'". */
export function describeFilterNote(note: FilterWordsNote): string {
  switch (note.kind) {
    case 'unknownName':
      // Only fields whose values are names (status, priority, assignee,
      // labels, milestone, goal, iteration, contact) give this note; each has a key.
      return t(`tasks:describeFilter.unknown.${note.field}`, { name: note.name })
    case 'unusable':
      return t('tasks:describeFilter.unusable', {
        field: fieldSpec(note.field as never)?.label ?? note.field
      })
    case 'cut':
      return t(`tasks:describeFilter.cut.${note.list}`, { count: note.sent })
  }
}

/**
 * Describe it (N8.1): a one-line box in the filter bar. Make filter sends the
 * words to Ostler AI and puts the filter it returns in the bar, replacing the
 * one there, with undo. The box keeps the words, so the person can rephrase.
 * Hidden while Ostler AI is not set up.
 */
export function DescribeFilter({
  projectId,
  filter,
  setFilter
}: {
  projectId: string
  filter: TaskFilter
  setFilter: (filter: TaskFilter) => void
}) {
  const { ai } = useFeatures()
  const { toastUndo } = useToast()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  if (!ai) return null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    setNotes([])
    const result = await window.ostlerAPI.filterFromWords(projectId, {
      text,
      today: todayIsoDate(),
      weekStart: localeWeekStart()
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    const words = result.value.notes.map(describeFilterNote)
    if (result.value.filter.conditions.length === 0) {
      setNotes([t('tasks:describeFilter.nothing'), ...words])
      return
    }
    setNotes(words)
    const previous = filter
    setFilter(result.value.filter)
    toastUndo(t('tasks:describeFilter.replaced'), () => setFilter(previous))
  }

  return (
    <>
      <Button
        ref={buttonRef}
        size="sm"
        variant={open ? 'secondary' : 'ghost'}
        icon={Sparkles}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {t('tasks:describeFilter.button')}
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        label={t('tasks:describeFilter.button')}
        placement="bottom-start"
        className="describe-filter"
      >
        <form className="describe-filter__form" onSubmit={(event) => void submit(event)}>
          <TextField
            label={t('tasks:describeFilter.label')}
            placeholder={t('tasks:describeFilter.placeholder')}
            value={text}
            maxLength={FILTER_WORDS_MAX_TEXT}
            autoFocus
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" size="sm" variant="ai" disabled={!text.trim()} loading={busy}>
            {t('tasks:describeFilter.make')}
          </Button>
        </form>
        <p className="describe-filter__hint">{t('tasks:describeFilter.whatIsSent')}</p>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        {notes.length > 0 && (
          <ul className="describe-filter__notes" aria-live="polite">
            {notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        )}
      </Popover>
    </>
  )
}
