import { useEffect, useState } from 'react'
import type { LibraryItem } from '@shared/ostler-api'
import { Dialog } from '../../ui'
import { libraryFileUrl } from '../project-detail/library/libraryUi'
import { t } from '@shared/i18n'
import { isAudioMime } from '@shared/audio-files'

/**
 * A popup preview of one attached Library item: a picture drawn full size, a
 * sound file (a voice memo) to play with its transcript, or a text file's text. Anything else says it has no preview. Nothing is added
 * to the task or its description by opening it.
 */
export function AttachmentPreview({
  projectId,
  itemId,
  onClose
}: {
  projectId: string
  itemId: string
  onClose: () => void
}) {
  const [item, setItem] = useState<LibraryItem | null>(null)
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void (async () => {
      const found = await window.ostlerAPI.getLibraryItem(projectId, itemId)
      if (!current || !found.ok) return
      setItem(found.value)
      if (found.value.kind === 'image' || isAudioMime(found.value.file?.mimeType)) return
      const read = await window.ostlerAPI.getLibraryItemText(projectId, itemId)
      if (current && read.ok) setText(read.value)
    })()
    return () => {
      current = false
    }
  }, [projectId, itemId])

  return (
    <Dialog open onClose={onClose} size="lg" title={item?.title ?? t('tasks:attachFiles.preview')}>
      {item?.kind === 'image' && item.file ? (
        <img
          className="task-attachment-preview__image"
          src={libraryFileUrl(item, 'file')}
          alt={item.title}
        />
      ) : item?.file && isAudioMime(item.file.mimeType) ? (
        <div className="task-attachment-preview__audio">
          <audio controls preload="metadata" src={libraryFileUrl(item, 'file')} />
          {item.body.trim() ? (
            <pre className="task-attachment-preview__text">{item.body}</pre>
          ) : (
            <p className="task-drawer__muted">{t('tasks:attachFiles.noTranscript')}</p>
          )}
        </div>
      ) : text ? (
        <pre className="task-attachment-preview__text">{text}</pre>
      ) : item ? (
        <p className="task-drawer__muted">{t('tasks:attachFiles.noPreview')}</p>
      ) : null}
    </Dialog>
  )
}
