import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LibraryItem, PlanningWorkItem } from '@shared/ostler-api'
import type { PlanningTaskType } from '@shared/ostler-api/task-type-types'
import {
  buildReleaseNotes,
  DEFAULT_RELEASE_NOTES_OPTIONS,
  RELEASE_NOTES_TAG,
  type PolishedReleaseNotes,
  type ReleaseNotesGroupBy,
  type ReleaseNotesOptions,
  type ReleaseNotesSource
} from '@shared/release-notes'
import { todayIsoDate } from '@shared/dates'
import { t } from '@shared/i18n'
import { useFeatures } from '../../navigation/features'
import { projectPath } from '../../navigation/paths'
import {
  Button,
  Checkbox,
  Dialog,
  InlineAlert,
  SegmentedControl,
  TextArea,
  useToast
} from '../../ui'
import { Sparkles } from '../../ui/icons'
import { SuggestionDiff, WritingHelpLayout } from '../../components/WritingHelp'
import '../../components/WritingHelp.css'
import './ReleaseNotesDialog.css'

/**
 * Write release notes (N9.9, N67): a milestone's or an iteration's finished
 * tasks, archived ones included, as a Markdown draft built by the shared
 * builder (the automation API uses the same one). Create note saves it as a
 * Library note tagged release-notes and opens it, with undo. Polish with AI
 * shows a friendlier version beside the draft, which replaces it only on
 * Accept.
 */
export function ReleaseNotesDialog({
  projectId,
  source,
  liveItems,
  taskTypes,
  onClose
}: {
  projectId: string
  source: ReleaseNotesSource
  /** The workspace's live tasks; the archived ones are loaded here. */
  liveItems: readonly PlanningWorkItem[]
  taskTypes: readonly PlanningTaskType[]
  onClose: () => void
}) {
  const features = useFeatures()
  const navigate = useNavigate()
  const { toastUndo } = useToast()
  const [options, setOptions] = useState<ReleaseNotesOptions>(DEFAULT_RELEASE_NOTES_OPTIONS)
  const [archived, setArchived] = useState<PlanningWorkItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [polished, setPolished] = useState<string | null>(null)
  const [pending, setPending] = useState<PolishedReleaseNotes | null>(null)
  const [polishing, setPolishing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [existing, setExisting] = useState<LibraryItem | null>(null)

  useEffect(() => {
    let active = true
    void window.ostlerAPI.getPlanningWorkItems(projectId, 'archived').then((result) => {
      if (!active) return
      if (result.ok) setArchived(result.value)
      else {
        setArchived([])
        setError(t('tasks:releaseNotes.couldntLoad'))
      }
    })
    return () => {
      active = false
    }
  }, [projectId])

  const notes = useMemo(
    () =>
      buildReleaseNotes(
        { source, items: [...liveItems, ...(archived ?? [])], taskTypes, today: todayIsoDate() },
        options
      ),
    [source, liveItems, archived, taskTypes, options]
  )
  const text = polished ?? notes.markdown
  const name = source.kind === 'milestone' ? source.milestone.name : source.iteration.name

  // A new option starts again from the tasks: the polished text was for the old draft.
  const change = (next: Partial<ReleaseNotesOptions>) => {
    setOptions((current) => ({ ...current, ...next }))
    setPolished(null)
    setPending(null)
    setExisting(null)
  }

  const polish = async () => {
    setError(null)
    setPolishing(true)
    try {
      const id = source.kind === 'milestone' ? source.milestone.id : source.iteration.id
      const result = await window.ostlerAPI.polishReleaseNotes(projectId, {
        source: { kind: source.kind, id },
        options
      })
      if (result.ok) setPending(result.value)
      else setError(result.error)
    } finally {
      setPolishing(false)
    }
  }

  const accept = () => {
    if (!pending) return
    setPolished(pending.suggestion)
    setPending(null)
  }

  const open = (item: LibraryItem) => {
    onClose()
    navigate(projectPath(projectId, 'library', { item: item.id }))
  }

  const save = async (mode: 'ask' | 'replace' | 'new') => {
    setError(null)
    setSaving(true)
    try {
      if (mode === 'ask') {
        const found = await window.ostlerAPI.listLibraryItems(projectId, { kind: 'note' })
        const same = found.ok
          ? found.value.find((item) => item.title.trim() === notes.title.trim())
          : undefined
        if (same) {
          setExisting(same)
          return
        }
      }
      if (mode === 'replace' && existing) {
        const before = existing.body
        const result = await window.ostlerAPI.updateLibraryItem(projectId, existing.id, {
          body: text
        })
        if (!result.ok) {
          setError(result.error)
          return
        }
        toastUndo(t('tasks:releaseNotes.replaced', { title: result.value.title }), () =>
          window.ostlerAPI.updateLibraryItem(projectId, existing.id, { body: before })
        )
        open(result.value)
        return
      }
      const result = await window.ostlerAPI.createLibraryItem(projectId, {
        kind: 'note',
        title: notes.title,
        body: text,
        tags: [RELEASE_NOTES_TAG]
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      const item = result.value
      toastUndo(t('tasks:releaseNotes.created', { title: item.title }), () =>
        window.ostlerAPI.deleteLibraryItem(projectId, item.id)
      )
      open(item)
    } finally {
      setSaving(false)
    }
  }

  const missing = pending ? pending.missingTitles : []
  const groupOptions: { value: ReleaseNotesGroupBy; label: string }[] = [
    { value: 'type', label: t('tasks:releaseNotes.groupByType') },
    { value: 'label', label: t('tasks:releaseNotes.groupByLabel') },
    { value: 'none', label: t('tasks:releaseNotes.groupByNone') }
  ]

  const suggestion = pending ? (
    <section className="writing-help__suggestion" aria-label={t('tasks:releaseNotes.suggestion')}>
      <h4 className="writing-help__title">{t('tasks:releaseNotes.suggestion')}</h4>
      {missing.length > 0 && (
        <InlineAlert tone="warning">
          {t('tasks:releaseNotes.missing', { count: missing.length, titles: missing.join(', ') })}
        </InlineAlert>
      )}
      <SuggestionDiff before={pending.draft} after={pending.suggestion} />
      <div className="writing-help__actions">
        <Button size="sm" variant="primary" onClick={accept}>
          {t('tasks:releaseNotes.accept')}
        </Button>
        <Button size="sm" loading={polishing} onClick={() => void polish()}>
          {t('tasks:releaseNotes.tryAgain')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
          {t('tasks:releaseNotes.discard')}
        </Button>
      </div>
    </section>
  ) : null

  return (
    <Dialog
      open
      size="lg"
      title={t('tasks:releaseNotes.dialogTitle')}
      description={t('tasks:releaseNotes.dialogDescription', { name })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('tasks:releaseNotes.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={saving && !existing}
            disabled={saving || archived === null || existing !== null}
            onClick={() => void save('ask')}
          >
            {t('tasks:releaseNotes.createNote')}
          </Button>
        </>
      }
    >
      <div className="release-notes">
        <div className="release-notes__options">
          <SegmentedControl
            label={t('tasks:releaseNotes.groupBy')}
            options={groupOptions}
            value={options.groupBy}
            onChange={(groupBy) => change({ groupBy })}
            size="sm"
          />
          <Checkbox
            label={t('tasks:releaseNotes.descriptions')}
            checked={options.descriptions}
            onChange={(event) => change({ descriptions: event.target.checked })}
          />
          <Checkbox
            label={t('tasks:releaseNotes.subtasks')}
            checked={options.subtasks}
            onChange={(event) => change({ subtasks: event.target.checked })}
          />
        </div>

        {error && (
          <InlineAlert tone="danger" onDismiss={() => setError(null)}>
            {error}
          </InlineAlert>
        )}

        {existing && (
          <InlineAlert tone="warning">
            <span>{t('tasks:releaseNotes.exists', { title: existing.title })}</span>
            <span className="release-notes__choice">
              <Button size="sm" disabled={saving} onClick={() => void save('replace')}>
                {t('tasks:releaseNotes.replace')}
              </Button>
              <Button size="sm" disabled={saving} onClick={() => void save('new')}>
                {t('tasks:releaseNotes.makeNew')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setExisting(null)}>
                {t('tasks:releaseNotes.cancel')}
              </Button>
            </span>
          </InlineAlert>
        )}

        <div className="release-notes__bar">
          {polished !== null && (
            <p className="release-notes__muted">{t('tasks:releaseNotes.polished')}</p>
          )}
          {features.ai && (
            <Button
              size="sm"
              variant="ai"
              icon={Sparkles}
              loading={polishing}
              disabled={polishing || archived === null || notes.taskTitles.length === 0}
              onClick={() => void polish()}
            >
              {polishing ? t('tasks:releaseNotes.polishing') : t('tasks:releaseNotes.polish')}
            </Button>
          )}
        </div>

        <WritingHelpLayout suggestion={suggestion}>
          {archived === null ? (
            <p className="release-notes__muted">{t('tasks:releaseNotes.loading')}</p>
          ) : (
            <>
              <TextArea
                label={t('tasks:releaseNotes.preview')}
                value={text}
                readOnly
                rows={16}
                className="release-notes__preview"
              />
              {notes.taskTitles.length === 0 && (
                <p className="release-notes__muted">{t('tasks:releaseNotes.noTasks')}</p>
              )}
            </>
          )}
        </WritingHelpLayout>
      </div>
    </Dialog>
  )
}
