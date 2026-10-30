import { useId, useState } from 'react'
import type { LibraryAiAccess, LibraryItem } from '@shared/ostler-api'
import { DEFAULT_AI_ACCESS } from '@shared/ostler-api'
import { Button, Dialog, InlineAlert, SegmentedControl, TextArea, TextField } from '../../../ui'
import '../../planning/planning-dialogs.css'
import { ACCESS_OPTIONS, bareHttpUrl } from './libraryUi'
import { t } from '@shared/i18n'
import { useFeatures } from '../../../navigation/features'
import { cloudFileOf } from '@shared/cloud-file-link'

interface LibraryLinkModalProps {
  projectId: string
  /** Null when adding. */
  item: LibraryItem | null
  initialUrl?: string
  onClose(): void
  onSaved(item: LibraryItem): void
}

/** Add or edit a link. Ostler stores the URL and note; it never fetches the page. */
export function LibraryLinkModal({
  projectId,
  item,
  initialUrl,
  onClose,
  onSaved
}: LibraryLinkModalProps) {
  const ai = useFeatures().ai
  const [url, setUrl] = useState(item?.url ?? initialUrl ?? '')
  const [title, setTitle] = useState(item?.title ?? '')
  const [note, setNote] = useState(item?.body ?? '')
  const [access, setAccess] = useState<LibraryAiAccess>(item?.aiAccess ?? DEFAULT_AI_ACCESS.link)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const clean = bareHttpUrl(url)
    if (!clean) {
      setError(t('library:libraryLinkModal.enterHttpHttpsUrl'))
      return
    }
    const fallbackTitle = (() => {
      try {
        return new URL(clean).hostname
      } catch {
        return clean
      }
    })()
    setSaving(true)
    setError(null)
    try {
      const fields = {
        url: clean,
        title: title.trim() || fallbackTitle,
        body: note,
        aiAccess: access
      }
      const result = item
        ? await window.ostlerAPI.updateLibraryItem(projectId, item.id, fields)
        : await window.ostlerAPI.createLibraryItem(projectId, { kind: 'link', ...fields })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onSaved(result.value)
    } finally {
      setSaving(false)
    }
  }

  const formId = useId()

  // A cloud file's link: its current name fills an empty title (integrations phase 3).
  const fillTitle = async () => {
    const clean = bareHttpUrl(url)
    if (!clean || title.trim() || !cloudFileOf(clean)) return
    const result = await window.ostlerAPI.readCloudFile(clean)
    if (result.ok && result.value?.name) {
      const name = result.value.name
      setTitle((current) => (current.trim() ? current : name.slice(0, 200)))
    }
  }

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      canDismiss={!saving}
      title={item ? t('library:libraryLinkModal.editLink') : t('library:libraryLinkModal.addLink')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('library:libraryLinkModal.cancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={saving} disabled={saving}>
            {saving
              ? t('library:libraryLinkModal.saving')
              : item
                ? t('library:libraryLinkModal.save')
                : t('library:libraryLinkModal.addLink')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <TextField
          label={t('library:libraryLinkModal.url')}
          type="url"
          value={url}
          autoFocus
          placeholder={t('library:libraryLinkModal.https')}
          onChange={(event) => setUrl(event.target.value)}
          onBlur={() => void fillTitle()}
        />
        <TextField
          label={t('library:libraryLinkModal.title')}
          value={title}
          maxLength={200}
          placeholder={t('library:libraryLinkModal.defaultsSiteName')}
          onChange={(event) => setTitle(event.target.value)}
        />
        <TextArea
          label={t('library:libraryLinkModal.note')}
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {ai && (
          <div className="ostler-library-field">
            <span className="ostler-library-field-label" aria-hidden="true">
              {t('library:libraryLinkModal.ostlerAiAccess')}
            </span>
            <SegmentedControl
              label={t('library:libraryLinkModal.ostlerAiAccess')}
              size="sm"
              value={access}
              onChange={setAccess}
              options={ACCESS_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
            />
          </div>
        )}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </form>
    </Dialog>
  )
}
