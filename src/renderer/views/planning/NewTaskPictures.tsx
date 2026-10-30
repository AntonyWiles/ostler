import { useState } from 'react'
import type { NewTaskPicture } from '@shared/new-task-window'
import { t } from '@shared/i18n'
import { IconButton } from '../../ui'
import { X } from '../../ui/icons'
import { libraryItemFileUrl } from '../project-detail/library/libraryUi'
import { AttachmentPreview } from './AttachmentPreview'
import './DescriptionPictures.css'

/**
 * The pictures pasted into New task's description (MOP-31): thumbnails along
 * the foot of the description, not links in its text. A thumbnail opens the
 * picture large; the cross takes it off the task. Create attaches them all.
 */
export function NewTaskPictures({
  projectId,
  pictures,
  onRemove
}: {
  projectId: string
  pictures: readonly NewTaskPicture[]
  onRemove: (id: string) => void
}) {
  const [previewId, setPreviewId] = useState<string | null>(null)
  if (pictures.length === 0) return null
  return (
    <>
      <ul className="task-description-pictures" aria-label={t('tasks:attachFiles.pictures')}>
        {pictures.map((picture) => (
          <li key={picture.id} className="task-description-pictures__item">
            <button
              type="button"
              className="task-description-pictures__button"
              title={t('tasks:attachFiles.previewTitle', { title: picture.title })}
              onClick={() => setPreviewId(picture.id)}
            >
              <img
                className="task-description-pictures__image"
                src={libraryItemFileUrl(projectId, picture.id, 'thumb')}
                alt={t('tasks:attachFiles.previewTitle', { title: picture.title })}
              />
            </button>
            <IconButton
              size="sm"
              icon={X}
              className="task-description-pictures__remove"
              label={t('tasks:attachFiles.removePicture', { title: picture.title })}
              onClick={() => onRemove(picture.id)}
            />
          </li>
        ))}
      </ul>
      {previewId && (
        <AttachmentPreview
          projectId={projectId}
          itemId={previewId}
          onClose={() => setPreviewId(null)}
        />
      )}
    </>
  )
}
