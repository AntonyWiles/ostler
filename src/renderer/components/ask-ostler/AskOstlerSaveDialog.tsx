import { useState, type FormEvent } from 'react'
import type { LibraryItem } from '@shared/ostler-api'
import {
  askNoteDefaultProject,
  askNoteMarkdown,
  askNoteTitle,
  type AskConversationTurn
} from '@shared/ask-ostler-note'
import { todayIsoDate } from '@shared/dates'
import { useOstler } from '../../context/OstlerContext'
import { Button, Dialog, InlineAlert, Select, TextField } from '../../ui'
import { t } from '@shared/i18n'
import { projectSelectOptions } from '../areas/project-options'

/**
 * Save as a note (N8.3b): which project's Library, and the title, then one
 * Library note holding the conversation. Default: the project most sources
 * came from; any of the person's projects can be chosen.
 */
export function AskOstlerSaveDialog({
  turns,
  onClose,
  onSaved
}: {
  turns: readonly AskConversationTurn[]
  onClose: () => void
  onSaved: (item: LibraryItem) => void
}) {
  const { projects, areas } = useOstler()
  const [projectId, setProjectId] = useState(() => {
    const preferred = askNoteDefaultProject(turns)
    return projects.some((project) => project.id === preferred)
      ? (preferred as string)
      : (projects[0]?.id ?? '')
  })
  const [title, setTitle] = useState(() => askNoteTitle(turns))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const projectName = (id: string) => projects.find((project) => project.id === id)?.name ?? ''

  const save = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!projectId || !title.trim() || saving) return
    setSaving(true)
    setError(null)
    const result = await window.ostlerAPI.createLibraryItem(projectId, {
      kind: 'note',
      title: title.trim(),
      body: askNoteMarkdown({ turns, projectId, projectName, today: todayIsoDate() })
    })
    setSaving(false)
    if (result.ok) onSaved(result.value)
    else setError(result.error)
  }

  return (
    <Dialog
      open
      size="sm"
      title={t('ai:askOstler.saveTitle')}
      description={t('ai:askOstler.saveDescription')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common:confirm.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!projectId || !title.trim() || saving}
            onClick={() => void save()}
          >
            {t('ai:askOstler.saveNote')}
          </Button>
        </>
      }
    >
      <form className="ask-ostler__save" onSubmit={(event) => void save(event)}>
        <Select
          label={t('ai:askOstler.saveProject')}
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          options={projectSelectOptions(projects, areas)}
        />
        <TextField
          label={t('ai:askOstler.saveNoteTitle')}
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          data-autofocus
        />
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </form>
    </Dialog>
  )
}
